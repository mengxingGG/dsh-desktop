/** Bounded self-launch of `dsh plugin` for one approved profile mutation. */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import type { InspectedPlugin } from './github.ts'

const MAX_OUTPUT_CHARACTERS = 128 * 1024
const SENSITIVE_ENVIRONMENT_NAME = /KEY|SECRET|TOKEN|PASSWORD/i

/** Installer policy resolved from plugin configuration. */
export interface InstallOptions {
  readonly environment?: NodeJS.ProcessEnv
  readonly executable?: string
  readonly execArgv?: readonly string[]
  readonly launcher?: string
  readonly platform?: NodeJS.Platform
  readonly profile: string
  readonly signal: AbortSignal
  readonly timeoutMs: number
}

interface ProcessExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly error?: Error
}

/**
 * Remove credential-like values before third-party lifecycle scripts run.
 * @param environment - inherited launcher environment.
 * @returns a copy without variables whose names indicate credentials.
 */
export function scrubEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment).filter(([name]) => !SENSITIVE_ENVIRONMENT_NAME.test(name)))
}

/**
 * Preserve only Node arguments required to execute the current dsh launcher.
 * @param execArgv - Node execution arguments from the active CLI process.
 * @returns loader and import arguments safe to forward to the installer child.
 */
export function launcherArgs(execArgv: readonly string[]): string[] {
  const result: string[] = []
  for (let index = 0; index < execArgv.length; index += 1) {
    const argument = execArgv[index]
    if (argument === undefined) continue
    if (argument === '--expose-internals' || argument.startsWith('--import=') || argument.startsWith('--loader=')) {
      result.push(argument)
    } else if (argument === '--import' || argument === '--loader') {
      const value = execArgv[index + 1]
      if (value !== undefined) {
        result.push(argument, value)
        index += 1
      }
    }
  }
  return result
}

/**
 * Build the exact launcher arguments used for one reviewed repository.
 * @param entry - revalidated repository and declared package name.
 * @param options - target profile and launcher execution policy.
 * @param launcher - resolved dsh JavaScript entrypoint.
 * @returns Node arguments for the hidden dsh plugin process.
 */
export function installArguments(entry: InspectedPlugin, options: InstallOptions, launcher: string): string[] {
  return [
    ...launcherArgs(options.execArgv ?? process.execArgv),
    launcher,
    'plugin', '--profile', options.profile,
    'add', entry.installSpec,
    `--allow-build=${entry.packageName}`,
  ]
}

async function stopTree(child: ChildProcess, exited: Promise<ProcessExit>, platform: NodeJS.Platform): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const pid = child.pid
  try {
    if (platform === 'win32' || pid === undefined) child.kill('SIGTERM')
    else process.kill(-pid, 'SIGTERM')
  } catch {
    // The child may exit between the state check and the signal.
  }
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolveTimeout) => {
      setTimeout(() => { resolveTimeout(false) }, 5_000)
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
      // A concurrent natural exit already reached quiescence.
    }
  }
  await exited
}

/**
 * Install one revalidated GitHub bundle into the configured profile.
 * @param entry - revalidated repository and package identity.
 * @param options - launcher, profile, timeout, environment, and cancellation policy.
 * @returns child exit code and bounded combined output.
 */
export async function installPlugin(
  entry: InspectedPlugin,
  options: InstallOptions,
): Promise<{ code: number; output: string }> {
  if (options.signal.aborted) throw new Error('plugin installation was cancelled before launch', { cause: options.signal.reason })
  const launcher = options.launcher ?? process.argv[1]
  if (launcher === undefined) throw new Error('plugin marketplace cannot locate the dsh launcher')
  const platform = options.platform ?? process.platform
  const child = spawn(
    options.executable ?? process.execPath,
    installArguments(entry, options, launcher),
    {
      detached: platform !== 'win32',
      env: scrubEnvironment(options.environment ?? process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  let output = ''
  const append = (chunk: Buffer | string): void => {
    output += chunk.toString()
    if (output.length > MAX_OUTPUT_CHARACTERS) output = output.slice(-MAX_OUTPUT_CHARACTERS)
  }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  let settle: ((value: ProcessExit) => void) | undefined
  let settled = false
  const exited = new Promise<ProcessExit>((resolveExit) => { settle = resolveExit })
  const finish = (value: ProcessExit): void => {
    if (settled) return
    settled = true
    settle?.(value)
  }
  child.once('error', (error) => { finish({ code: null, signal: null, error }) })
  child.once('exit', (code, signal) => { finish({ code, signal }) })

  const stop = { reason: undefined as 'timeout' | 'cancel' | undefined }
  const requestStop = (reason: 'timeout' | 'cancel'): void => {
    stop.reason ??= reason
    void stopTree(child, exited, platform)
  }
  const cancel = (): void => { requestStop('cancel') }
  options.signal.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => { requestStop('timeout') }, options.timeoutMs)
  const result = await exited
  clearTimeout(timer)
  options.signal.removeEventListener('abort', cancel)

  if (stop.reason === 'timeout') throw new Error(`plugin installation timed out after ${String(options.timeoutMs)} ms\n${output}`)
  if (stop.reason === 'cancel') throw new Error('plugin installation was cancelled', { cause: options.signal.reason })
  if (result.error !== undefined) throw result.error
  return { code: result.code ?? 1, output }
}
