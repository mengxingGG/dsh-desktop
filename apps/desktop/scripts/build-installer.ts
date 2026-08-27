/** Build one self-contained desktop installer on its matching target host. */

import { spawn } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { prepareInstallerRuntime } from './prepare-installer.ts'

const require = createRequire(import.meta.url)
const appDir = resolve(import.meta.dirname, '..')

type TargetPlatform = 'win' | 'linux'

function currentTarget(): TargetPlatform {
  if (process.platform === 'win32') return 'win'
  if (process.platform === 'linux') return 'linux'
  throw new Error(`desktop installer does not support ${process.platform}`)
}

async function builderCli(): Promise<string> {
  const manifestPath = require.resolve('electron-builder/package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { bin?: string | Record<string, string> }
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.['electron-builder']
  if (entry === undefined) throw new Error('electron-builder declares no CLI')
  return resolve(manifestPath, '..', entry)
}

/** Stage the runtime and build the installer for the current operating system. */
export async function buildInstaller(requested = currentTarget()): Promise<void> {
  const current = currentTarget()
  if (requested !== current) {
    throw new Error(`build ${requested} installer on its target host; current host is ${current}`)
  }
  await rm(resolve(appDir, 'dist', 'installers'), { recursive: true, force: true, maxRetries: 6, retryDelay: 250 })
  await prepareInstallerRuntime()
  const target = requested === 'win' ? 'nsis' : 'deb'
  const child = spawn(process.execPath, [
    await builderCli(), `--${requested}`, target,
    '--publish', 'never', '--config', 'electron-builder.installer.json',
  ], { cwd: appDir, env: process.env, stdio: 'inherit', windowsHide: true })
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>((settle) => {
    let settled = false
    const finish = (value: { code: number | null; signal: NodeJS.Signals | null; error?: Error }): void => {
      if (settled) return
      settled = true
      settle(value)
    }
    child.once('error', error => finish({ code: null, signal: null, error }))
    child.once('exit', (code, signal) => finish({ code, signal }))
  })
  if (result.error !== undefined) throw result.error
  if (result.code !== 0) throw new Error(`electron-builder exited with ${String(result.code ?? result.signal)}`)
}

if (import.meta.main) await buildInstaller(process.argv[2] as TargetPlatform | undefined)
