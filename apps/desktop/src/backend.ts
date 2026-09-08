/** Lifecycle owner for the local `dsh web` process used by the desktop shell. */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { desktopControl } from './control.ts'

const require = createRequire(import.meta.url)
const READY_PREFIX = 'dsh web:'
const MAX_LOG_CHARACTERS = 64 * 1024

/** How the backend process ended. */
interface BackendExit {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly error?: Error
}

/** Running local Web backend and its bounded diagnostic output. */
export interface BackendHandle {
  readonly url: URL
  readonly exited: Promise<BackendExit>
  /** Return the bounded combined stdout and stderr captured so far. */
  logs(): string
  /** Read live task activity through the parent-only backend plugin. */
  activity(): Promise<boolean>
  /** Stop and persist before exit; false means active work needs explicit confirmation. */
  shutdown(confirmed: boolean): Promise<boolean>
  /** Force-stop the backend tree without a persistence guarantee; startup/error cleanup only. */
  stop(): Promise<void>
}

/** Startup dependencies that tests can replace without launching a process. */
export interface BackendStartOptions {
  readonly argsPrefix?: readonly string[]
  readonly cliPath?: string
  readonly cwd?: string
  readonly environment?: NodeJS.ProcessEnv
  readonly executable?: string
  readonly platform?: NodeJS.Platform
  readonly signal?: AbortSignal
  readonly startupTimeoutMs?: number
  readonly controlPatch?: string
  readonly shutdownTimeoutMs?: number
}

/** Startup failure with the bounded child diagnostics captured before teardown. */
export class BackendStartupError extends Error {
  readonly logs: string

  constructor(message: string, logs: string, cause: unknown) {
    super(message, { cause })
    this.name = 'BackendStartupError'
    this.logs = logs
  }
}

/** Locate the built public CLI carried by the desktop app's production dependencies. */
function resolveDshCliPath(): string {
  const manifest = require.resolve('@deepseek-ai/dsh/package.json')
  return resolve(dirname(manifest), 'lib', 'bin.js')
}

/** Parse only the loopback URL line emitted by the Web bundle after its tree settles. */
export function parseBackendUrl(line: string): URL | undefined {
  if (!line.startsWith(READY_PREFIX)) return undefined
  let url: URL
  try {
    url = new URL(line.slice(READY_PREFIX.length).trim())
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port === '') return undefined
  return url
}

/** Retain the newest diagnostic suffix without allowing a noisy child to grow memory forever. */
export function appendBoundedLog(current: string, chunk: string, limit = MAX_LOG_CHARACTERS): string {
  const combined = current + chunk
  return combined.length <= limit ? combined : combined.slice(combined.length - limit)
}

/** Terminate a spawned process tree and wait for the root process to report exit. */
async function stopProcessTree(
  child: ChildProcess,
  exited: Promise<BackendExit>,
  platform: NodeJS.Platform,
  graceMs = 5_000,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    await exited
    return
  }
  const pid = child.pid
  if (platform === 'win32' && pid !== undefined) {
    // Windows maps child.kill() to TerminateProcess; keep the root alive until
    // taskkill has enumerated its descendants.
    const stopped = spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore', windowsHide: true, timeout: graceMs,
    })
    if (stopped.error !== undefined) throw stopped.error
    if (stopped.status !== 0) {
      throw new Error(`taskkill could not stop the desktop backend tree (${String(stopped.status)})`)
    }
    await exited
    return
  }
  try {
    if (pid === undefined) child.kill('SIGTERM')
    else process.kill(-pid, 'SIGTERM')
  } catch {
    // The process may have exited between the state check and the signal.
  }

  let graceTimer: ReturnType<typeof setTimeout> | undefined
  let graceful: boolean
  try {
    graceful = await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolveTimeout) => {
        graceTimer = setTimeout(() => { resolveTimeout(false) }, graceMs)
      }),
    ])
  } finally {
    clearTimeout(graceTimer)
  }
  if (graceful) return

  try {
    if (pid === undefined) child.kill('SIGKILL')
    else process.kill(-pid, 'SIGKILL')
  } catch {
    // A concurrent natural exit already reached the requested quiescence.
  }
  await exited
}

/** Start `dsh web` on an OS-selected loopback port and wait for its settled URL line. */
export async function startBackend(options: BackendStartOptions = {}): Promise<BackendHandle> {
  if (options.signal?.aborted === true) {
    throw new BackendStartupError('dsh web startup was cancelled', '', options.signal.reason)
  }
  const platform = options.platform ?? process.platform
  const executable = options.executable ?? process.execPath
  const argsPrefix = options.argsPrefix ?? ['--expose-internals', options.cliPath ?? resolveDshCliPath()]
  const environment = {
    ...options.environment ?? process.env,
    ELECTRON_RUN_AS_NODE: '1',
  }
  const controlPatch = options.controlPatch === undefined ? [] : ['--patch', options.controlPatch]
  const child = spawn(executable, [...argsPrefix, 'web', ...controlPatch, '--no-open', '--host', '127.0.0.1', '--port', '0'], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    detached: platform !== 'win32',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  })
  const control = desktopControl(child, options.shutdownTimeoutMs ?? 30_000)

  let log = ''
  let stdoutRemainder = ''
  let settleReady: ((url: URL) => void) | undefined
  let rejectReady: ((error: Error) => void) | undefined
  let settleExit: ((exit: BackendExit) => void) | undefined
  let readySettled = false
  let exitSettled = false

  const ready = new Promise<URL>((resolveReady, reject) => {
    settleReady = resolveReady
    rejectReady = reject
  })
  const exited = new Promise<BackendExit>((resolveExit) => {
    settleExit = resolveExit
  })

  const finishExit = (exit: BackendExit): void => {
    if (exitSettled) return
    exitSettled = true
    settleExit?.(exit)
    if (!readySettled) {
      readySettled = true
      rejectReady?.(exit.error ?? new Error(`dsh web exited before startup (${String(exit.exitCode ?? exit.signal)})`))
    }
  }

  // Both streams are explicitly piped; Node's four-entry IPC overload loses that narrowing.
  const stdout = child.stdout as Readable
  const stderr = child.stderr as Readable
  stdout.setEncoding('utf8')
  stderr.setEncoding('utf8')
  stdout.on('data', (chunk: string) => {
    log = appendBoundedLog(log, chunk)
    stdoutRemainder += chunk
    const lines = stdoutRemainder.split(/\r?\n/)
    stdoutRemainder = lines.pop() ?? ''
    for (const line of lines) {
      const url = parseBackendUrl(line)
      if (url !== undefined && !readySettled) {
        readySettled = true
        settleReady?.(url)
      }
    }
  })
  stderr.on('data', (chunk: string) => {
    log = appendBoundedLog(log, chunk)
  })
  child.once('error', (error) => { finishExit({ exitCode: null, signal: null, error }) })
  child.once('close', (exitCode, signal) => { finishExit({ exitCode, signal }) })

  const abortStartup = (): void => {
    if (readySettled) return
    readySettled = true
    rejectReady?.(new Error('dsh web startup was cancelled'))
  }
  options.signal?.addEventListener('abort', abortStartup, { once: true })

  const timeoutMs = options.startupTimeoutMs ?? 45_000
  const timeout = setTimeout(() => {
    if (readySettled) return
    readySettled = true
    rejectReady?.(new Error(`dsh web did not report a URL within ${String(timeoutMs)} ms`))
  }, timeoutMs)
  let stopping: Promise<void> | undefined
  const stop = (): Promise<void> => stopping ??= stopProcessTree(child, exited, platform)

  try {
    const url = await ready
    return {
      url,
      exited,
      logs: () => log,
      activity: () => control.activity(),
      shutdown: async (confirmed) => {
        if (!await control.shutdown(confirmed)) return false
        // The backend holds its root PID after saving so Windows can enumerate
        // and terminate the complete tree, including unregistered descendants.
        await stop()
        return true
      },
      stop,
    }
  } catch (error) {
    await stop()
    throw new BackendStartupError(error instanceof Error ? error.message : String(error), log, error)
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abortStartup)
  }
}
