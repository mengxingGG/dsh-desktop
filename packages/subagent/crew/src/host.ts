/** Host-owned exact process execution and checkout evidence for Crew gates. */

import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, readlink, realpath } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import type { BigIntStats } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { pipeline } from 'node:stream/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {
  CrewCheckoutSnapshot,
  CrewCommandResult,
  CrewCommandSpec,
} from './types.ts'
import { CrewError } from './error.ts'
import type { CrewExecutionLimits } from './execution.ts'
import { repositoryPath, resolveRepositoryPath } from './validation.ts'

/** Execute trusted, previously validated argv and derive project evidence. */
export class CrewHost {
  /**
   * @param ctx - Crew context with exact-argv subprocess and filesystem services.
   * @param limits - Operator-owned output and process limits.
   */
  constructor(private readonly ctx: Context, private readonly limits: CrewExecutionLimits) {}

  /**
   * Run an authorized command in the actual project, retaining its generated files.
   * Commands use the host account; file-tool scopes are not an operating-system sandbox.
   * @param repositoryRoot - Absolute repository root authorized by Crew configuration.
   * @param command - Validated shell-free command declaration.
   * @param signal - Caller cancellation signal.
   * @returns Bounded process output and terminal status.
   */
  async runCommand(
    repositoryRoot: string,
    command: CrewCommandSpec,
    signal: AbortSignal,
  ): Promise<CrewCommandResult> {
    signal.throwIfAborted()
    const root = await realpath(repositoryRoot)
    const cwd = await realpath(command.cwd === '.' ? root : resolveRepositoryPath(root, command.cwd, 'command cwd'))
    const fromRoot = relative(root, cwd)
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new CrewError('Crew command cwd escapes the project directory', 'CREW_INVALID_PATH')
    }
    return await this.runExact(command, cwd, signal)
  }

  /**
   * Capture Git evidence when available, or all local files without requiring Git initialization.
   * @param repositoryRoot - Absolute project directory.
   * @param signal - Caller cancellation signal.
   * @returns Frozen checkout evidence for a Crew gate.
   */
  async inspectCheckout(repositoryRoot: string, signal: AbortSignal): Promise<CrewCheckoutSnapshot> {
    signal.throwIfAborted()
    if (await pathInfo(join(repositoryRoot, '.git')) === undefined) {
      return await this.inspectLocalFiles(repositoryRoot, signal)
    }
    const branch = await this.git(repositoryRoot, ['symbolic-ref', '--short', '-q', 'HEAD'], signal)
    if (branch.timedOut || (branch.exitCode !== 0 && branch.exitCode !== 1)) {
      throw new CrewError(`cannot read repository branch: ${diagnostic(branch)}`, 'CREW_HOST_FAILURE')
    }
    const head = await this.git(repositoryRoot, ['rev-parse', '--verify', '--quiet', 'HEAD'], signal)
    if (head.exitCode === 1 && !head.timedOut && branch.exitCode === 0) {
      const ref = await this.git(repositoryRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch.stdout.trim()}`], signal)
      if (ref.exitCode === 1 && !ref.timedOut) return await this.inspectLocalFiles(repositoryRoot, signal)
    }
    if (head.exitCode !== 0 || head.timedOut) {
      throw new CrewError(`cannot read repository HEAD: ${diagnostic(head)}`, 'CREW_HOST_FAILURE')
    }
    const index = await this.readIndex(repositoryRoot, signal)
    const status = await this.git(repositoryRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], signal)
    if (status.exitCode !== 0 || status.timedOut) {
      throw new CrewError(`cannot read repository status: ${diagnostic(status)}`, 'CREW_HOST_FAILURE')
    }
    const parsed = parsePorcelain(status.stdout)
    const pathDigests: Record<string, string> = {}
    for (const path of parsed.changedPaths) {
      pathDigests[path] = await this.pathDigest(repositoryRoot, path, signal, 'git')
    }
    if (await this.readIndex(repositoryRoot, signal) !== index) {
      throw new CrewError('Git index changed while collecting checkout evidence', 'CREW_CHECKOUT_DRIFT')
    }
    const statusDigest = createHash('sha256')
      .update(JSON.stringify({ porcelain: status.stdout, index, pathDigests }))
      .digest('hex')
    return {
      head: head.stdout.trim(),
      ...(branch.exitCode === 0 && branch.stdout.trim().length > 0 ? { branch: branch.stdout.trim() } : {}),
      statusDigest,
      changedPaths: parsed.changedPaths,
      stagedPaths: parsed.stagedPaths,
      pathDigests,
    }
  }

  private async inspectLocalFiles(repositoryRoot: string, signal: AbortSignal): Promise<CrewCheckoutSnapshot> {
    const paths = new Map<string, string>()
    const directories = new Map<string, BigIntStats>()
    const visit = async (directory: string): Promise<void> => {
      signal.throwIfAborted()
      const before = await pathInfo(directory)
      if (before === undefined || !before.isDirectory() || before.isSymbolicLink()) {
        throw new CrewError('Project directory changed while collecting evidence', 'CREW_CHECKOUT_DRIFT')
      }
      directories.set(directory, before)
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const name = entry.name.toLowerCase()
        if (name === '.git' || name === '.env' || name.startsWith('.env.')) continue
        const absolute = join(directory, entry.name)
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          if (this.limits.ignoredDirectories?.some(value => value.toLowerCase() === name)) continue
          await visit(absolute)
        } else {
          const path = gitPath(relative(repositoryRoot, absolute).split(sep).join('/'))
          paths.set(path, await this.pathDigest(repositoryRoot, path, signal, 'files'))
        }
      }
    }
    await visit(repositoryRoot)
    for (const [directory, before] of directories) {
      signal.throwIfAborted()
      if (!sameFileObservation(before, await pathInfo(directory))) {
        throw new CrewError('Project directory changed while collecting evidence', 'CREW_CHECKOUT_DRIFT')
      }
    }
    const pathDigests = Object.fromEntries(paths)
    return {
      head: null,
      statusDigest: createHash('sha256').update(JSON.stringify(pathDigests)).digest('hex'),
      changedPaths: Object.keys(pathDigests).sort(),
      stagedPaths: [],
      pathDigests,
    }
  }

  /**
   * Return required artifact paths that are absent or not regular files.
   * @param repositoryRoot - Absolute repository root authorized by Crew configuration.
   * @param requiredArtifacts - Normalized repository-relative artifact paths.
   * @param signal - Caller cancellation signal.
   * @returns Missing or non-file artifact paths.
   */
  async missingArtifacts(
    repositoryRoot: string,
    requiredArtifacts: readonly string[],
    signal: AbortSignal,
  ): Promise<string[]> {
    const fs = this.ctx.get('fs')
    if (fs === undefined) throw new CrewError('Crew requires a filesystem provider', 'CREW_INVALID_CONFIG')
    const missing: string[] = []
    for (const path of requiredArtifacts) {
      signal.throwIfAborted()
      const normalized = repositoryPath(path, 'required artifact')
      const target = await fs.resolve(resolveRepositoryPath(repositoryRoot, normalized, 'required artifact'), { signal })
      const info = await fs.stat(target, signal)
      if (info?.type !== 'file') missing.push(normalized)
    }
    return missing
  }

  /**
   * Run one trusted Git argv without shell parsing.
   * @param repositoryRoot - Absolute Git checkout root.
   * @param args - Exact Git arguments excluding the executable name.
   * @param signal - Caller cancellation signal.
   * @returns Bounded diagnostics and terminal status; checkout reads separately establish the write result.
   */
  async runGit(repositoryRoot: string, args: readonly string[], signal: AbortSignal): Promise<CrewCommandResult> {
    const command: CrewCommandSpec = {
      id: 'git-host',
      argv: ['git', ...args],
      cwd: '.',
      timeoutMs: this.limits.gitTimeoutMs,
    }
    return await this.runExact(command, repositoryRoot, signal)
  }

  private async git(repositoryRoot: string, args: readonly string[], signal: AbortSignal): Promise<CrewCommandResult> {
    const result = await this.runGit(repositoryRoot, args, signal)
    if (result.stdoutTruncated || result.stderrTruncated) {
      throw new CrewError(
        `Git output exceeded maxOutputBytes (${this.limits.maxOutputBytes}) and was truncated; increase the configured limit`,
        'CREW_HOST_FAILURE',
      )
    }
    if (result.signal !== null) {
      throw new CrewError(`Git was terminated by ${result.signal}`, 'CREW_HOST_FAILURE')
    }
    return result
  }

  /** Observe logical entries, excluding the stat-cache bytes that ordinary Git reads refresh. */
  private async readIndex(repositoryRoot: string, signal: AbortSignal): Promise<string> {
    const result = await this.git(repositoryRoot, ['ls-files', '--stage', '-v', '-z'], signal)
    if (result.exitCode !== 0 || result.timedOut) {
      throw new CrewError(`cannot read repository index: ${diagnostic(result)}`, 'CREW_HOST_FAILURE')
    }
    if (result.stdout.length === 0) return result.stdout
    if (!result.stdout.endsWith('\0')) {
      throw new CrewError('Git index returned an incomplete record', 'CREW_HOST_FAILURE')
    }
    for (const record of result.stdout.slice(0, -1).split('\0')) {
      const entry = /^([HMShms]) [0-7]{6} (?:[0-9a-f]{40}|[0-9a-f]{64}) [0-3]\t(.+)$/su.exec(record)
      if (entry === null) throw new CrewError('Git index returned an unsupported record', 'CREW_HOST_FAILURE')
      if (entry[1] !== 'H' && entry[1] !== 'M') {
        throw new CrewError(
          `Git index flag hides "${entry[2]}"; clear assume-unchanged and skip-worktree before using Crew`,
          'CREW_CHECKOUT_DRIFT',
        )
      }
    }
    return result.stdout
  }

  private async pathDigest(repositoryRoot: string, path: string, signal: AbortSignal, source: 'git' | 'files'): Promise<string> {
    signal.throwIfAborted()
    const absolute = resolveRepositoryPath(repositoryRoot, path, 'checkout path')
    let parent = repositoryRoot
    for (const part of path.split('/').slice(0, -1)) {
      signal.throwIfAborted()
      parent = join(parent, part)
      if ((await pathInfo(parent))?.isSymbolicLink()) {
        throw new CrewError(`checkout path "${path}" has a parent directory link`, 'CREW_CHECKOUT_DRIFT')
      }
    }
    const before = await pathInfo(absolute)
    if (before === undefined) return '!missing'
    let content: string
    if (before.isFile()) {
      if (source === 'git') {
        const result = await this.git(repositoryRoot, ['hash-object', '--no-filters', '--', path], signal)
        if (result.exitCode !== 0 || result.timedOut) {
          throw new CrewError(`cannot hash changed path "${path}": ${diagnostic(result)}`, 'CREW_HOST_FAILURE')
        }
        content = result.stdout.trim()
      } else {
        const hash = createHash('sha256')
        await pipeline(createReadStream(absolute), hash, { signal })
        content = hash.digest('hex')
      }
    } else if (before.isSymbolicLink()) {
      content = await readlink(absolute)
    } else if (before.isDirectory()) {
      content = ''
    } else {
      throw new CrewError(`cannot inspect non-regular checkout path "${path}"`, 'CREW_HOST_FAILURE')
    }
    const after = await pathInfo(absolute)
    signal.throwIfAborted()
    if (!sameFileObservation(before, after)) {
      throw new CrewError(`checkout path "${path}" changed while collecting evidence`, 'CREW_CHECKOUT_DRIFT')
    }
    return createHash('sha256').update(`${before.mode}:${content}`).digest('hex')
  }

  private async runExact(
    command: CrewCommandSpec,
    cwd: string,
    signal: AbortSignal,
  ): Promise<CrewCommandResult> {
    const subprocess = this.ctx.get('subprocess')
    if (subprocess === undefined) throw new CrewError('Crew requires a subprocess provider', 'CREW_INVALID_CONFIG')
    const timeout = new AbortController()
    const timer = setTimeout(() => {
      timeout.abort(new Error(`Crew command "${command.id}" exceeded ${command.timeoutMs} ms`))
    }, command.timeoutMs)
    const fused = AbortSignal.any([signal, timeout.signal])
    try {
      const program = command.argv[0]
      if (program === undefined) throw new CrewError('Crew command argv is empty', 'CREW_INVALID_COMMAND')
      const executable = await subprocess.resolveExecutable(program, undefined, fused)
      const handle = subprocess.spawn({
        argv: await this.commandArgv(executable, command.argv.slice(1), fused),
        cwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: this.limits.maxOutputBytes },
          stderr: { maxBytes: this.limits.maxOutputBytes },
        },
        graceMs: this.limits.processGraceMs,
        signal: fused,
        ...(command.id === 'git-host' ? { env: cleanGitEnvironment() } : {}),
      })
      const outcome = await handle.done
      await handle.waitForExit()
      signal.throwIfAborted()
      const stdout = handle.collected.stdout?.readFrom(0)
      const stderr = handle.collected.stderr?.readFrom(0)
      return {
        commandId: command.id,
        argv: structuredClone(command.argv),
        cwd: command.cwd,
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        timedOut: timeout.signal.aborted && !signal.aborted,
        stdout: stdout?.text ?? '',
        stderr: stderr?.text ?? '',
        stdoutTruncated: stdout?.lossy ?? false,
        stderrTruncated: stderr?.lossy ?? false,
      }
    } catch (error: unknown) {
      if (signal.aborted) signal.throwIfAborted()
      throw new CrewError(`Crew command "${command.id}" could not run: ${error instanceof Error ? error.message : String(error)}`, 'CREW_HOST_FAILURE', { cause: error })
    } finally {
      clearTimeout(timer)
    }
  }

  /** Resolve installed Node package shims without passing model arguments through cmd.exe. */
  private async commandArgv(executable: string, args: readonly string[], signal: AbortSignal): Promise<string[]> {
    if (process.platform !== 'win32' || !/\.(?:cmd|bat)$/iu.test(executable)) return [executable, ...args]
    const program = basename(executable).replace(/\.(?:cmd|bat)$/iu, '')
    const packagePath = createRequire(executable).resolve(`${program}/package.json`)
    const metadata: unknown = JSON.parse(await readFile(packagePath, 'utf8'))
    const bins: unknown = typeof metadata === 'object' && metadata !== null && 'bin' in metadata ? metadata.bin : undefined
    const entry: unknown = typeof bins === 'string' ? bins
      : typeof bins === 'object' && bins !== null && program in bins ? Reflect.get(bins, program) : undefined
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new CrewError(`Windows command ${program} requires an installed Node package executable`, 'CREW_INVALID_COMMAND')
    }
    const node = await this.ctx.subprocess.resolveExecutable('node', undefined, signal)
    return [node, resolve(dirname(packagePath), entry), ...args]
  }
}

function sameFileObservation(before: BigIntStats, after: BigIntStats | undefined): boolean {
  return after !== undefined && before.dev === after.dev && before.ino === after.ino
    && before.mode === after.mode && before.size === after.size && before.nlink === after.nlink
    && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs
}

async function pathInfo(path: string): Promise<BigIntStats | undefined> {
  try {
    return await lstat(path, { bigint: true })
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return undefined
    }
    throw new CrewError(`cannot inspect checkout path "${path}"`, 'CREW_HOST_FAILURE', { cause: error })
  }
}

function cleanGitEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.keys(process.env)
    .filter(key => key.toUpperCase().startsWith('GIT_'))
    .map(key => [key, undefined]))
}

/**
 * Parse NUL-delimited porcelain-v1 records without shell or locale dependence.
 * @param output - Raw `git status --porcelain=v1 -z` output.
 * @returns Sorted changed and staged repository-relative paths.
 */
export function parsePorcelain(output: string): { changedPaths: string[]; stagedPaths: string[] } {
  if (output.length > 0 && !output.endsWith('\0')) {
    throw new CrewError('Git status returned an incomplete porcelain record', 'CREW_HOST_FAILURE')
  }
  const changed = new Set<string>()
  const staged = new Set<string>()
  const records = output.split('\0')
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === undefined || record.length === 0) continue
    if (record.length < 4 || record[2] !== ' ') {
      throw new CrewError('Git status returned an unsupported porcelain record', 'CREW_HOST_FAILURE')
    }
    const status = record.slice(0, 2)
    const path = gitPath(record.slice(3))
    changed.add(path)
    if (status[0] !== ' ' && status[0] !== '?') staged.add(path)
    if (status.includes('R') || status.includes('C')) {
      const paired = records[index + 1]
      if (paired === undefined || paired.length === 0) {
        throw new CrewError('Git status returned an incomplete rename record', 'CREW_HOST_FAILURE')
      }
      changed.add(gitPath(paired))
      if (status[0] !== ' ') staged.add(gitPath(paired))
      index += 1
    }
  }
  return {
    changedPaths: [...changed].sort(),
    stagedPaths: [...staged].sort(),
  }
}

function gitPath(path: string): string {
  if (path !== path.trim() || path.includes('\\')) {
    throw new CrewError('Git status returned a path that requires spelling normalization', 'CREW_HOST_FAILURE')
  }
  if (path.length === 0 || path.startsWith('/') || /^[A-Za-z]:\//u.test(path)) {
    throw new CrewError('Git status returned a non-relative path', 'CREW_HOST_FAILURE')
  }
  const parts = path.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new CrewError('Git status returned an invalid path component', 'CREW_HOST_FAILURE')
  }
  return parts.join('/')
}

function diagnostic(result: CrewCommandResult): string {
  const text = result.stderr.trim() || result.stdout.trim()
  return text.length === 0 ? `exit ${String(result.exitCode)}` : text.slice(0, 500)
}
