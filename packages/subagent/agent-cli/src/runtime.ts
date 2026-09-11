/** Bounded native CLI process and terminal ownership. */
import type { Context } from '@deepseek-ai/cordis'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { stripVTControlCharacters } from 'node:util'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import type { CliProvider, CliLoginId, CliLoginSnapshot } from './types.ts'

/** Native auxiliary command bounds and environment. */
export interface RuntimeConfig {
  readonly env: Record<string, string>
  readonly accountTimeoutMs: number
  readonly outputBytes: number
  readonly disposeGraceMs: number
  readonly loginTimeoutMs: number
}

/**
 * Resolve a native executable without shell shims or global installation changes.
 * @param provider - Native product route.
 * @param override - Explicit absolute executable path, if configured.
 * @returns Existing executable path; absent installation rejects.
 */
export async function executable(provider: CliProvider, override?: string): Promise<string> {
  const file = provider === 'grok-cli' ? 'grok' : provider === 'codex-cli' ? 'codex' : 'agy'
  if (override !== undefined && !isAbsolute(override)) throw new Error('CLI executable override must be absolute')
  const candidates = override === undefined ? [
    ...(process.platform === 'win32' ? [provider === 'grok-cli' ? join(homedir(), '.grok', 'bin', 'grok.exe')
      : provider === 'codex-cli'
        ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe')
        : join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'agy', 'bin', 'agy.exe')] : []),
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map(dir => join(dir, file + (process.platform === 'win32' ? '.exe' : ''))),
  ] : [override]
  for (const path of candidates) {
    try { await access(path, constants.X_OK); return path }
    catch (error) {
      if (!['ENOENT', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
    }
  }
  throw new Error(file + ' CLI is not installed or its executable is unavailable')
}

/** Admission closes before all native process ranges are drained. */
export class CliRuntime {
  private closed = false
  private readonly active = new Map<AbortController, Promise<unknown>>()
  private readonly logins = new Map<CliProvider, {
    snapshot: CliLoginSnapshot
    controller: AbortController
    terminal: SubprocessTerminalHandle
    done: Promise<unknown>
  }>()

  constructor(private readonly ctx: Context, private readonly config: RuntimeConfig) {
    ctx.effect(() => async () => {
      this.closed = true
      for (const controller of this.active.keys()) controller.abort(new Error('CLI adapters unloaded'))
      await Promise.allSettled(this.active.values())
    }, 'cli-agents: native operation lifetime')
  }

  /**
   * Own cancellation and cleanup until a native operation settles.
   * @param run - Operation with an owned cancellation controller.
   * @param signal - Calling Agent or Remote cancellation.
   * @returns Operation result after cleanup.
   */
  async run<T>(run: (controller: AbortController) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.closed) throw new Error('CLI adapters unloaded')
    signal?.throwIfAborted()
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    const work = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return run(controller) })
    this.active.set(controller, work)
    try { return await work }
    finally { this.active.delete(controller); signal?.removeEventListener('abort', abort) }
  }

  /**
   * Run one bounded native command, optionally observing complete stdout lines.
   * @param argv - Executable and literal arguments.
   * @param cwd - Private CLI workspace or account working directory.
   * @param signal - Owner cancellation.
   * @param timeoutMs - Command deadline.
   * @param stdin - Optional complete stdin input.
   * @param line - Native protocol observer; throwing terminates the process range.
   * @returns Bounded stdout, stderr and exit code.
   */
  async command(argv: string[], cwd: string, signal: AbortSignal, timeoutMs: number, stdin?: string,
    line?: (text: string) => void): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const controller = new AbortController()
    const child = this.ctx.subprocess.spawn({ argv, cwd, env: this.config.env,
      signal: AbortSignal.any([signal, controller.signal]), graceMs: this.config.disposeGraceMs,
      stdio: { stdin: stdin === undefined ? 'ignore' : { data: stdin }, stdout: 'pipe', stderr: { maxBytes: this.config.outputBytes } } })
    const timer = setTimeout(() => controller.abort(new Error('CLI command timed out')), timeoutMs)
    const done = child.done
    void done.catch(() => {})
    try {
      if (child.stdout === undefined) throw new Error('CLI stdout unavailable')
      const decoder = new StringDecoder('utf8')
      let output = '', pending = '', bytes = 0
      for await (const chunk of child.stdout) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
        bytes += buffer.length
        if (bytes > this.config.outputBytes) throw new Error('CLI output exceeded the configured byte limit')
        const text = decoder.write(buffer)
        output += text
        pending += text
        let end: number
        while ((end = pending.indexOf('\n')) >= 0) {
          const value = pending.slice(0, end).trim()
          pending = pending.slice(end + 1)
          if (value) line?.(value)
        }
      }
      const tail = decoder.end()
      output += tail
      pending += tail
      if (pending.trim()) line?.(pending.trim())
      const result = await done
      signal.throwIfAborted()
      controller.signal.throwIfAborted()
      return { stdout: output, stderr: child.collected.stderr?.readFrom(0).text ?? '', exitCode: result.exitCode }
    } finally {
      clearTimeout(timer)
      child.terminate()
      await child.waitForExit()
    }
  }

  /**
   * Start a user-controlled native authorization terminal.
   * @param provider - Account being changed.
   * @param argv - Native login command.
   * @returns Initial login state; no input is automatically submitted.
   */
  async startLogin(provider: CliProvider, argv: string[]): Promise<CliLoginSnapshot> {
    const current = this.logins.get(provider)
    if (current?.snapshot.status === 'running') {
      return { ...current.snapshot, output: stripVTControlCharacters(current.snapshot.output) }
    }
    const started = Promise.withResolvers<CliLoginSnapshot>()
    const work = this.run(async (controller) => {
      const terminal = await this.ctx.subprocess.spawnTerminal({ argv, cwd: homedir(), env: this.config.env,
        rows: 30, cols: 100, graceMs: this.config.disposeGraceMs, signal: controller.signal })
      const attempt = { snapshot: { id: randomUUID() as CliLoginId, provider, status: 'running' as CliLoginSnapshot['status'],
        output: '', truncated: false, error: null as string | null }, controller, terminal, done: Promise.resolve() as Promise<unknown> }
      this.logins.set(provider, attempt)
      const abort = () => { void terminal.terminate().catch(() => {}) }
      controller.signal.addEventListener('abort', abort, { once: true })
      if (controller.signal.aborted) abort()
      const timer = setTimeout(() => controller.abort(new Error('CLI login timed out')), this.config.loginTimeoutMs)
      started.resolve(attempt.snapshot)
      const output = (async () => {
        const decoder = new StringDecoder('utf8')
        for await (const chunk of terminal.output) {
          const next = attempt.snapshot.output + decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
          const bytes = Buffer.from(next)
          const truncated = bytes.length > this.config.outputBytes
          attempt.snapshot = { ...attempt.snapshot, output: truncated ? bytes.subarray(-this.config.outputBytes).toString('utf8') : next,
            truncated: attempt.snapshot.truncated || truncated }
        }
      })()
      void output.catch(() => controller.abort(new Error('CLI login output failed')))
      try {
        const result = await terminal.done
        attempt.snapshot = { ...attempt.snapshot, status: controller.signal.aborted ? 'cancelled' : result.exitCode === 0 ? 'completed' : 'failed' }
      } catch (error) {
        attempt.snapshot = { ...attempt.snapshot, status: 'failed', error: error instanceof Error ? error.message : String(error) }
      } finally {
        clearTimeout(timer)
        controller.signal.removeEventListener('abort', abort)
        await terminal.terminate()
        await output
      }
    })
    void work.catch(error => started.reject(error))
    const snapshot = await started.promise
    const attempt = this.logins.get(provider)
    assert(attempt)
    attempt.done = work
    return snapshot
  }

  /**
   * Read the current native authorization terminal without polling an account API.
   * @param provider - Selected account.
   * @returns Latest detached progress, or null before login.
   */
  login(provider: CliProvider): CliLoginSnapshot | null {
    const attempt = this.logins.get(provider)
    return attempt ? { ...attempt.snapshot, output: stripVTControlCharacters(attempt.snapshot.output) } : null
  }

  /**
   * Deliver one explicit user input to the displayed terminal.
   * @param provider - Selected account.
   * @param id - Exact login attempt identity.
   * @param text - User text, including explicit Enter or cursor keystrokes.
   * @returns Completion after input delivery.
   */
  async input(provider: CliProvider, id: CliLoginId, text: string): Promise<void> {
    const attempt = this.logins.get(provider)
    if (!attempt || attempt.snapshot.id !== id || attempt.snapshot.status !== 'running') throw new Error('CLI login is no longer active')
    if (Buffer.byteLength(text) > 4096 || text.includes('\0')) throw new Error('CLI login input is invalid')
    await attempt.terminal.write(text)
  }

  /**
   * Close the displayed native login terminal and wait for process cleanup.
   * @param provider - Selected account.
   * @param id - Exact login identity.
   * @returns Completion after cleanup.
   */
  async cancel(provider: CliProvider, id: CliLoginId): Promise<void> {
    const attempt = this.logins.get(provider)
    if (!attempt || attempt.snapshot.id !== id) throw new Error('CLI login attempt changed')
    attempt.controller.abort()
    await attempt.done
  }
}
