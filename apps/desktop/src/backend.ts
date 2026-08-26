/** Lifecycle owner for the local `dsh web` process used by the desktop shell. */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

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
  /** Stop the complete backend process tree and wait for exit. */
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
  if (child.exitCode !== null || child.signalCode !== null) return
  const pid = child.pid
  try {
    if (platform === 'win32' || pid === undefined) child.kill('SIGTERM')
    else process.kill(-pid, 'SIGTERM')
  } catch {
    // The process may have exited between the state check and the signal.
  }

  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolveTimeout) => {
      setTimeout(() => { resolveTimeout(false) }, graceMs)
    }),
  ])
  if (graceful) return

  if (platform === 'win32' && pid !== undefined) {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } else {
    try {
      if (pid === undefined) child.kill('SIGKILL')
      else process.kill(-pid, 'SIGKILL')
    } catch {
      // A concurrent natural exit already reached the requested quiescence.
    }
  }
  await exited
}

/** Start `dsh web` on an OS-selected loopback port and wait for its settled URL line. */
export async function startBackend(options: BackendStartOptions = {}): Promise<BackendHandle> {
  const platform = options.platform ?? process.platform
  const executable = options.executable ?? process.execPath
  const argsPrefix = options.argsPrefix ?? ['--expose-internals', options.cliPath ?? resolveDshCliPath()]
  const environment = {
    ...options.environment ?? process.env,
    ELECTRON_RUN_AS_NODE: '1',
  }
  const child = spawn(executable, [...argsPrefix, 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    detached: platform !== 'win32',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

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

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
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
  child.stderr.on('data', (chunk: string) => {
    log = appendBoundedLog(log, chunk)
  })
  child.once('error', (error) => { finishExit({ exitCode: null, signal: null, error }) })
  child.once('exit', (exitCode, signal) => { finishExit({ exitCode, signal }) })

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

  try {
    const url = await ready
    return {
      url,
      exited,
      logs: () => log,
      stop: async () => stopProcessTree(child, exited, platform),
    }
  } catch (error) {
    await stopProcessTree(child, exited, platform)
    throw new BackendStartupError(error instanceof Error ? error.message : String(error), log, error)
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abortStartup)
  }
}
