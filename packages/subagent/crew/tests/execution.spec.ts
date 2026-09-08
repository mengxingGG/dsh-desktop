import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CrewHost } from '../src/host.ts'

const LIMITS = { maxOutputBytes: 1024, processGraceMs: 5_000, gitTimeoutMs: 10_000 }
const SIGNAL = new AbortController().signal
const roots: string[] = []
const contexts: Context[] = []

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-crew-execution-test-'))
  roots.push(root)
  mkdirSync(join(root, 'project', 'src'), { recursive: true })
  writeFileSync(join(root, 'project', 'src', 'input.txt'), 'input')
  return root
}

async function host(): Promise<CrewHost> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalSubprocessRuntime)
  return new CrewHost(ctx, LIMITS)
}

afterEach(async () => {
  vi.unstubAllEnvs()
  const settled = await Promise.allSettled(contexts.splice(0).map(async (ctx) => { await ctx.fiber.dispose() }))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  const failed = settled.filter(result => result.status === 'rejected')
  if (failed.length > 0) throw new AggregateError(failed.map(result => result.reason as unknown), 'execution fixture disposal failed')
})

describe('Crew project commands', () => {
  it('uses installed project dependencies, supports child pipes, and retains generated files', async () => {
    const root = fixture()
    const runtime = await host()
    mkdirSync(join(root, 'project/node_modules/fixture-dependency'), { recursive: true })
    writeFileSync(join(root, 'project/node_modules/fixture-dependency/index.js'), "module.exports = 'local dependency'")
    writeFileSync(join(root, 'project/src/probe.cjs'), [
      "const { readFileSync, writeFileSync } = require('node:fs')",
      "const { execFileSync } = require('node:child_process')",
      "const dependency = require('fixture-dependency')",
      "const child = execFileSync(process.execPath, ['-e', \"console.log('child complete')\"], { encoding: 'utf8' }).trim()",
      "writeFileSync('src/output.txt', dependency + ': ' + child)",
      "console.log(readFileSync('src/output.txt', 'utf8'))",
    ].join('\n'))
    const result = await runtime.runCommand(root, {
      id: 'probe', argv: ['node', 'src/probe.cjs'], cwd: 'project', timeoutMs: 20_000,
    }, SIGNAL)
    expect(result.timedOut).toBe(false)
    expect(result.signal).toBeNull()
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('local dependency: child complete')
    expect(readFileSync(join(root, 'project/src/output.txt'), 'utf8')).toBe('local dependency: child complete')
  })

  it('runs an npm test script at the project root', async () => {
    const root = fixture()
    const project = join(root, 'project')
    writeFileSync(join(project, 'package.json'), JSON.stringify({
      private: true, scripts: { test: 'node src/test.cjs' },
    }))
    writeFileSync(join(project, 'src/test.cjs'), "console.log('npm script completed')")
    const result = await (await host()).runCommand(project, {
      id: 'npm-test', argv: ['npm', 'run', 'test'], cwd: '.', timeoutMs: 20_000,
    }, SIGNAL)
    expect(result.timedOut).toBe(false)
    expect(result.signal).toBeNull()
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('npm script completed')
  })

  it('uses subprocess credential scrubbing without clearing ordinary environment settings', async () => {
    const root = fixture()
    vi.stubEnv('DSH_CREW_FIXTURE_TOKEN', 'fixture-only-secret')
    vi.stubEnv('CREW_FIXTURE_LOCALE', 'zh-CN')
    const result = await (await host()).runCommand(root, {
      id: 'environment', argv: ['node', '-e', 'console.log(JSON.stringify({ hidden: process.env.DSH_CREW_FIXTURE_TOKEN === undefined, locale: process.env.CREW_FIXTURE_LOCALE }))'],
      cwd: 'project', timeoutMs: 20_000,
    }, SIGNAL)
    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ hidden: true, locale: 'zh-CN' })
  })

  it('rejects escaped working directories and cancellation before spawning', async () => {
    const root = fixture()
    const project = join(root, 'project')
    const runtime = await host()
    mkdirSync(join(root, 'outside'))
    symlinkSync(join(root, 'outside'), join(project, 'escape'), 'junction')
    const command = { id: 'escape', argv: ['node', '-e', "require('fs').writeFileSync('escaped.txt', 'bad')"], cwd: 'escape', timeoutMs: 20_000 }
    await expect(runtime.runCommand(project, command, SIGNAL)).rejects.toThrow('escapes the project')
    await expect(runtime.runCommand(project, { ...command, cwd: '../outside' }, SIGNAL)).rejects.toThrow('invalid path')
    await expect(runtime.runCommand(project, { ...command, cwd: '.' }, AbortSignal.abort(new Error('cancelled command')))).rejects.toThrow('cancelled command')
    expect(existsSync(join(project, 'escaped.txt'))).toBe(false)
    expect(existsSync(join(root, 'outside/escaped.txt'))).toBe(false)
  })

  it('retains nonzero exit status and diagnostics', async () => {
    const result = await (await host()).runCommand(fixture(), {
      id: 'failure', argv: ['node', '-e', "console.error('test failed'); process.exitCode = 7"], cwd: 'project', timeoutMs: 20_000,
    }, SIGNAL)
    expect(result.timedOut).toBe(false)
    expect(result.signal).toBeNull()
    expect(result.exitCode).toBe(7)
    expect(result.stderr).toContain('test failed')
  })

  it('retains bounded stream tails and ends a running command at its deadline', async () => {
    const root = fixture()
    const runtime = await host()
    const noisy = await runtime.runCommand(root, {
      id: 'noisy', argv: ['node', '-e', "process.stdout.write('x'.repeat(20000) + 'TAIL'); process.stderr.write('y'.repeat(20000) + 'END')"],
      cwd: 'project', timeoutMs: 20_000,
    }, SIGNAL)
    expect(noisy.timedOut).toBe(false)
    expect(noisy.signal).toBeNull()
    expect(noisy.exitCode).toBe(0)
    expect(noisy.stdout.length).toBe(LIMITS.maxOutputBytes)
    expect(noisy.stdout.endsWith('TAIL')).toBe(true)
    expect(noisy.stderr.endsWith('END')).toBe(true)
    expect(noisy.stdoutTruncated).toBe(true)
    expect(noisy.stderrTruncated).toBe(true)
    const timed = await runtime.runCommand(root, {
      id: 'timeout', argv: ['node', '-e', "console.log('READY'); setInterval(() => {}, 1000)"],
      cwd: 'project', timeoutMs: 5_000,
    }, SIGNAL)
    expect(timed.stdout).toContain('READY')
    expect(timed.timedOut).toBe(true)
    expect(timed.exitCode).not.toBe(0)
  }, 30_000)
})
