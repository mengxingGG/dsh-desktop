import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { CrewHost } from '../src/host.ts'

const LIMITS = {
  maxOutputBytes: 1024, processGraceMs: 5_000, gitTimeoutMs: 10_000,
}
const SIGNAL = new AbortController().signal

async function fixture(maxOutputBytes = LIMITS.maxOutputBytes, state: 'committed' | 'unborn' | 'absent' = 'committed') {
  const root = mkdtempSync(join(tmpdir(), 'dsh-crew-checkout-'))
  const ctx = new Context()
  onTestFinished(async () => {
    try { await ctx.fiber.dispose() } finally { rmSync(root, { recursive: true, force: true }) }
  })
  await ctx.plugin(LocalSubprocessRuntime)
  const git = (...args: string[]): string => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', timeout: LIMITS.gitTimeoutMs,
  })
  writeFileSync(join(root, 'tracked.txt'), 'seed\n')
  if (state !== 'absent') {
    git('init', '-b', 'main')
    git('config', 'user.name', 'Crew fixture')
    git('config', 'user.email', 'crew@example.test')
    git('config', 'core.autocrlf', 'false')
    if (state === 'committed') {
      git('add', '--', 'tracked.txt')
      git('-c', 'core.hooksPath=', 'commit', '-m', 'seed fixture')
    }
  }
  return { root, ctx, git, host: new CrewHost(ctx, { ...LIMITS, maxOutputBytes }) }
}

describe('Crew checkout evidence', () => {
  it('captures a detached checkout without inventing a branch', async () => {
    const { root, host, git } = await fixture()
    git('checkout', '--detach', '-q')
    const checkout = await host.inspectCheckout(root, SIGNAL)
    expect(checkout.head).toBe(git('rev-parse', 'HEAD').trim())
    expect(checkout.branch).toBeUndefined()
    expect(checkout.changedPaths).toEqual([])
  })

  it.each(['absent', 'unborn'] as const)('verifies local files when Git is %s without initializing or committing', async (state) => {
    const { root, ctx, host } = await fixture(LIMITS.maxOutputBytes, state)
    const spawn = vi.spyOn(ctx.subprocess, 'spawn')
    onTestFinished(() => { spawn.mockRestore() })
    const before = await host.inspectCheckout(root, SIGNAL)
    expect(before.head).toBeNull()
    expect(before.branch).toBeUndefined()
    expect(before.stagedPaths).toEqual([])
    expect(before.changedPaths).toEqual(['tracked.txt'])
    expect(await host.inspectCheckout(root, SIGNAL)).toEqual(before)
    writeFileSync(join(root, 'tracked.txt'), 'edit\n')
    writeFileSync(join(root, 'added.txt'), 'created\n')
    const edited = await host.inspectCheckout(root, SIGNAL)
    expect(edited.pathDigests['tracked.txt']).not.toBe(before.pathDigests['tracked.txt'])
    expect(edited.changedPaths).toEqual(['added.txt', 'tracked.txt'])
    unlinkSync(join(root, 'tracked.txt'))
    const removed = await host.inspectCheckout(root, SIGNAL)
    expect(removed.changedPaths).toEqual(['added.txt'])
    expect(removed.pathDigests['tracked.txt']).toBeUndefined()
    expect(removed.statusDigest).not.toBe(edited.statusDigest)
    expect(existsSync(join(root, '.git'))).toBe(state !== 'absent')
    if (state === 'absent') expect(spawn).not.toHaveBeenCalled()
    else expect(spawn.mock.calls.every(([spec]) => ['symbolic-ref', 'rev-parse', 'show-ref'].includes(spec.argv[1]!))).toBe(true)
  })

  it('records a directory link without reading the linked tree in local mode', async () => {
    const { root, host } = await fixture(LIMITS.maxOutputBytes, 'absent')
    const outside = mkdtempSync(join(tmpdir(), 'dsh-crew-local-outside-'))
    const link = join(root, 'linked')
    onTestFinished(() => {
      if (existsSync(link)) unlinkSync(link)
      rmSync(outside, { recursive: true, force: true })
    })
    writeFileSync(join(outside, 'private.txt'), 'outside content')
    symlinkSync(outside, link, 'junction')
    const before = await host.inspectCheckout(root, SIGNAL)
    expect(before.changedPaths).toEqual(['linked', 'tracked.txt'])
    writeFileSync(join(outside, 'private.txt'), 'changed outside content')
    expect(await host.inspectCheckout(root, SIGNAL)).toEqual(before)
  })

  it('honors cancellation before inspecting a local folder', async () => {
    const { root, host } = await fixture(LIMITS.maxOutputBytes, 'absent')
    await expect(host.inspectCheckout(root, AbortSignal.abort(new Error('cancelled inspection'))))
      .rejects.toThrow('cancelled inspection')
  })

  it('excludes protected credentials and preserves ordinary file names in local evidence', async () => {
    const { root, host } = await fixture(LIMITS.maxOutputBytes, 'absent')
    writeFileSync(join(root, '.env'), 'fixture-only protected value')
    writeFileSync(join(root, '.ENV.local'), 'fixture-only protected value')
    writeFileSync(join(root, '__proto__'), 'ordinary file')
    const checkout = await host.inspectCheckout(root, SIGNAL)
    expect(checkout.changedPaths).toEqual(['__proto__', 'tracked.txt'])
    expect(Object.hasOwn(checkout.pathDigests, '__proto__')).toBe(true)
  })

  it.each([
    ['symbolic-ref', 'branch'],
    ['status', 'status'],
    ['ls-files', 'index'],
  ] as const)('rejects failed %s observations', async (command, subject) => {
    const { root, ctx, host } = await fixture()
    const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
    const spy = vi.spyOn(ctx.subprocess, 'spawn').mockImplementation(spec => spawn(spec.argv.includes(command)
      ? { ...spec, argv: [spec.argv[0]!, 'rev-parse', '--verify', 'refs/heads/missing-fixture-branch'] }
      : spec))
    try {
      await expect(host.inspectCheckout(root, SIGNAL)).rejects.toThrow(`cannot read repository ${subject}`)
    } finally {
      spy.mockRestore()
    }
  })

  it('refuses a truncated Git status even when its retained tail contains complete records', async () => {
    const { root, host } = await fixture(128)
    for (let index = 0; index < 4; index += 1) {
      writeFileSync(join(root, `entry-0${index}-${'x'.repeat(51)}`), 'input')
    }
    await expect(host.inspectCheckout(root, SIGNAL)).rejects.toThrow(/Git output.*truncated/u)
  })

  it('refuses truncated Git diagnostics instead of returning an incomplete result', async () => {
    const { root, ctx, host } = await fixture(128)
    const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
    const spy = vi.spyOn(ctx.subprocess, 'spawn').mockImplementation(spec => spawn({
      ...spec, argv: [spec.argv[0]!, 'x'.repeat(1024)],
    }))
    try {
      await expect(host.inspectCheckout(root, SIGNAL)).rejects.toThrow(/Git output.*truncated/u)
    } finally {
      spy.mockRestore()
    }
  })

  it('preserves a completed Git write when only its diagnostic output was truncated', async () => {
    const { root, host, git } = await fixture(128)
    writeFileSync(join(root, 'tracked.txt'), 'changed\n')
    git('add', '--', 'tracked.txt')
    const message = 'fixture commit ' + 'x'.repeat(512)
    const result = await host.runGit(root, ['-c', 'core.hooksPath=', 'commit', '-m', message], SIGNAL)
    expect(result.timedOut).toBe(false)
    expect(result.signal).toBeNull()
    expect(result.exitCode).toBe(0)
    expect(result.stdoutTruncated).toBe(true)
    expect(git('log', '-1', '--format=%B').trim()).toBe(message)
    expect((await host.inspectCheckout(root, SIGNAL)).changedPaths).toEqual([])
  })

  it('does not report a failed hash operation as a missing file', async () => {
    const { root, ctx, host } = await fixture()
    writeFileSync(join(root, 'tracked.txt'), 'changed\n')
    const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
    const spy = vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
      if (spec.argv.includes('hash-object')) unlinkSync(join(root, 'tracked.txt'))
      return spawn(spec)
    })
    try {
      await expect(host.inspectCheckout(root, SIGNAL)).rejects.toThrow(/cannot hash changed path/u)
    } finally {
      spy.mockRestore()
    }
  })

  it.each(['rewrite', 'remove'] as const)('rejects a %s after Git hashes a file but before evidence is published', async (change) => {
    const { root, ctx, host } = await fixture()
    writeFileSync(join(root, 'tracked.txt'), 'changed\n')
    const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
    const spy = vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
      const handle = spawn(spec)
      const reader = handle.collected.stdout
      if (spec.argv.includes('hash-object') && reader !== undefined) {
        const readFrom = reader.readFrom.bind(reader)
        const readSpy = vi.spyOn(reader, 'readFrom').mockImplementation((offset) => {
          const result = readFrom(offset)
          if (change === 'rewrite') writeFileSync(join(root, 'tracked.txt'), 'replaced after hashing\n')
          else unlinkSync(join(root, 'tracked.txt'))
          readSpy.mockRestore()
          return result
        })
        onTestFinished(() => { readSpy.mockRestore() })
      }
      return handle
    })
    try {
      await expect(host.inspectCheckout(root, SIGNAL)).rejects.toThrow(/changed while collecting evidence/u)
    } finally {
      spy.mockRestore()
    }
  })

  it('distinguishes a deleted tracked file from an empty directory at the same path', async () => {
    const { root, host } = await fixture()
    unlinkSync(join(root, 'tracked.txt'))
    const deleted = await host.inspectCheckout(root, SIGNAL)
    mkdirSync(join(root, 'tracked.txt'))
    const directory = await host.inspectCheckout(root, SIGNAL)
    expect(directory.changedPaths).toEqual(deleted.changedPaths)
    expect(directory.pathDigests['tracked.txt']).not.toBe(deleted.pathDigests['tracked.txt'])
  })

  it('refuses to hash a tracked path through a replaced parent directory', async () => {
    const { root, ctx, host, git } = await fixture()
    const nested = join(root, 'nested')
    mkdirSync(nested)
    writeFileSync(join(nested, 'input.txt'), 'repository input\n')
    git('add', '--', 'nested/input.txt')
    git('-c', 'core.hooksPath=', 'commit', '-m', 'seed nested input')
    const outside = mkdtempSync(join(tmpdir(), 'dsh-crew-checkout-outside-'))
    onTestFinished(() => { rmSync(outside, { recursive: true, force: true }) })
    writeFileSync(join(outside, 'input.txt'), 'fixture-only credential canary\n')
    rmSync(nested, { recursive: true })
    symlinkSync(outside, nested, 'junction')
    const spy = vi.spyOn(ctx.subprocess, 'spawn')
    try {
      await expect(host.inspectCheckout(root, SIGNAL)).rejects.toThrow(/parent.*link/u)
      expect(spy.mock.calls.some(([spec]) => spec.argv.includes('hash-object')
        && spec.argv.includes('nested/input.txt'))).toBe(false)
    } finally {
      spy.mockRestore()
      unlinkSync(nested)
    }
  })

  it.each(['missing', 'regular file'] as const)('records absent descendants when their parent becomes %s', async (replacement) => {
    const { root, host, git } = await fixture()
    const nested = join(root, 'nested')
    mkdirSync(nested)
    writeFileSync(join(nested, 'input.txt'), 'repository input\n')
    git('add', '--', 'nested/input.txt')
    git('-c', 'core.hooksPath=', 'commit', '-m', 'seed nested input')
    rmSync(nested, { recursive: true })
    if (replacement === 'regular file') writeFileSync(nested, 'replacement file\n')
    const checkout = await host.inspectCheckout(root, SIGNAL)
    expect(checkout.pathDigests['nested/input.txt']).toBe('!missing')
  })

  it.skipIf(process.platform !== 'linux')('does not treat filesystem access denial as an absent file', async () => {
    const { root, ctx, host } = await fixture()
    const nested = join(root, 'nested')
    mkdirSync(nested, { mode: 0o700 })
    writeFileSync(join(nested, 'input.txt'), 'repository input\n')
    const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
    const spy = vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
      const handle = spawn(spec)
      return {
        ...handle,
        done: handle.done.then((outcome) => {
          if (spec.argv.includes('hash-object')) chmodSync(nested, 0o000)
          return outcome
        }),
      }
    })
    try {
      await expect(host.inspectCheckout(root, SIGNAL)).rejects.toThrow(/cannot inspect checkout path/u)
    } finally {
      spy.mockRestore()
      chmodSync(nested, 0o700)
    }
  })

  it.skipIf(process.platform !== 'linux')('records executable-mode changes even when Git ignores file mode', async () => {
    const { root, host, git } = await fixture()
    git('config', 'core.filemode', 'false')
    writeFileSync(join(root, 'tracked.txt'), 'changed\n')
    chmodSync(join(root, 'tracked.txt'), 0o644)
    const plain = await host.inspectCheckout(root, SIGNAL)
    chmodSync(join(root, 'tracked.txt'), 0o755)
    const executable = await host.inspectCheckout(root, SIGNAL)
    expect(executable.changedPaths).toEqual(plain.changedPaths)
    expect(executable.pathDigests['tracked.txt']).not.toBe(plain.pathDigests['tracked.txt'])
  })

  it.skipIf(process.platform !== 'linux')('hashes a symbolic link itself without reading its target content', async () => {
    const { root, host } = await fixture()
    writeFileSync(join(root, 'alias'), 'seed\n')
    const plain = await host.inspectCheckout(root, SIGNAL)
    unlinkSync(join(root, 'alias'))
    symlinkSync('tracked.txt', join(root, 'alias'))
    const linked = await host.inspectCheckout(root, SIGNAL)
    writeFileSync(join(root, 'tracked.txt'), 'changed target\n')
    const changedTarget = await host.inspectCheckout(root, SIGNAL)
    expect(linked.pathDigests.alias).not.toBe(plain.pathDigests.alias)
    expect(changedTarget.pathDigests.alias).toBe(linked.pathDigests.alias)
  })

  it('propagates caller cancellation instead of returning checkout evidence', async () => {
    const { root, host } = await fixture()
    const signal = AbortSignal.abort(new Error('cancelled checkout'))
    await expect(host.inspectCheckout(root, signal)).rejects.toThrow('cancelled checkout')
  })

  it('propagates caller cancellation after Git exits before publishing its result', async () => {
    const { root, ctx, host } = await fixture()
    const controller = new AbortController()
    const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
    const spy = vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
      const handle = spawn(spec)
      return {
        ...handle,
        done: handle.done.then((outcome) => {
          expect(outcome.exitCode).toBe(0)
          expect(outcome.signal).toBeNull()
          controller.abort(new Error('cancelled before publishing'))
          return outcome
        }),
      }
    })
    try {
      await expect(host.runGit(root, ['rev-parse', 'HEAD'], controller.signal))
        .rejects.toThrow('cancelled before publishing')
    } finally {
      spy.mockRestore()
    }
  })

  it('keeps unchanged working files stable across the authorized Git staging step', async () => {
    const { root, host, git } = await fixture()
    writeFileSync(join(root, 'tracked.txt'), 'changed\n')
    const unstaged = await host.inspectCheckout(root, SIGNAL)
    git('add', '--', 'tracked.txt')
    const staged = await host.inspectCheckout(root, SIGNAL)
    expect(staged.pathDigests).toEqual(unstaged.pathDigests)
    expect(staged.stagedPaths).toEqual(['tracked.txt'])
    expect(staged.statusDigest).not.toBe(unstaged.statusDigest)
  })

  it('detects different staged objects with identical status text and working files', async () => {
    const { root, host, git } = await fixture()
    const stageContent = (content: string) => {
      const object = execFileSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: root, input: content, encoding: 'utf8', timeout: LIMITS.gitTimeoutMs,
      }).trim()
      git('update-index', '--cacheinfo', `100644,${object},tracked.txt`)
    }
    writeFileSync(join(root, 'tracked.txt'), 'working content\n')
    stageContent('first staged content\n')
    const first = await host.inspectCheckout(root, SIGNAL)
    const status = git('status', '--porcelain=v1', '-z')
    stageContent('second staged content\n')
    const second = await host.inspectCheckout(root, SIGNAL)
    expect(git('status', '--porcelain=v1', '-z')).toBe(status)
    expect(second.pathDigests).toEqual(first.pathDigests)
    expect(second.stagedPaths).toEqual(first.stagedPaths)
    expect(second.statusDigest).not.toBe(first.statusDigest)
  })

  it('rejects index updates while collecting working-file evidence', async () => {
    const { root, ctx, host, git } = await fixture()
    writeFileSync(join(root, 'tracked.txt'), 'changed\n')
    const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
    const spy = vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
      const handle = spawn(spec)
      return {
        ...handle,
        done: handle.done.then((outcome) => {
          if (spec.argv.includes('hash-object')) git('add', '--', 'tracked.txt')
          return outcome
        }),
      }
    })
    try {
      await expect(host.inspectCheckout(root, SIGNAL)).rejects.toThrow(/Git index changed while collecting/u)
    } finally {
      spy.mockRestore()
    }
  })

  it('keeps checkout evidence stable when Git refreshes its file-stat cache', async () => {
    const { root, host, git } = await fixture()
    const before = await host.inspectCheckout(root, SIGNAL)
    const index = readFileSync(join(root, '.git', 'index'))
    utimesSync(join(root, 'tracked.txt'), 946684800, 946684800)
    git('update-index', '--refresh')
    expect(readFileSync(join(root, '.git', 'index'))).not.toEqual(index)
    expect(await host.inspectCheckout(root, SIGNAL)).toEqual(before)
  })

  it.each(['H 100644 ' + '1'.repeat(40) + ' 0\ttracked.txt', 'malformed\0'])(
    'rejects incomplete or malformed index output: %j', async (output) => {
      const { root, ctx, host } = await fixture()
      const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
      const spy = vi.spyOn(ctx.subprocess, 'spawn').mockImplementation(spec => spawn(spec.argv.includes('ls-files')
        ? { ...spec, argv: [process.execPath, '-e', `process.stdout.write(${JSON.stringify(output)})`] }
        : spec))
      try {
        await expect(host.inspectCheckout(root, SIGNAL)).rejects.toThrow(/Git index returned/u)
      } finally {
        spy.mockRestore()
      }
    },
  )

  it.each(['assume-unchanged', 'skip-worktree'] as const)('refuses %s flags that hide changed tracked files', async (flag) => {
    const { root, host, git } = await fixture()
    git('update-index', `--${flag}`, '--', 'tracked.txt')
    writeFileSync(join(root, 'tracked.txt'), 'hidden working change\n')
    expect(git('status', '--porcelain=v1', '-z')).toBe('')
    await expect(host.inspectCheckout(root, SIGNAL)).rejects.toThrow(/Git index.*hides.*tracked.txt/u)
    expect(git('ls-files', '-v', '--', 'tracked.txt')[0]).toBe(flag === 'skip-worktree' ? 'S' : 'h')
    git('update-index', `--no-${flag}`, '--', 'tracked.txt')
    expect((await host.inspectCheckout(root, SIGNAL)).changedPaths).toEqual(['tracked.txt'])
  })

  it('captures deletion of the final index entry', async () => {
    const { root, host, git } = await fixture()
    unlinkSync(join(root, 'tracked.txt'))
    git('add', '--', 'tracked.txt')
    const checkout = await host.inspectCheckout(root, SIGNAL)
    expect(checkout.stagedPaths).toEqual(['tracked.txt'])
    expect(checkout.pathDigests).toEqual({ 'tracked.txt': '!missing' })
    expect(git('ls-files', '--stage', '-z')).toBe('')
  })
})
