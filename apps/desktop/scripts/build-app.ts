/** Build the current platform's directly runnable desktop artifact at repository root. */

import { spawn } from 'node:child_process'
import { chmod, cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const appDir = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(appDir, '..', '..')
const outputDir = resolve(appDir, 'dist', `app-build-${String(process.pid)}`)

async function findMacApp(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory() && entry.name.endsWith('.app')) return path
    if (entry.isDirectory()) {
      const nested = await findMacApp(path).catch(() => undefined)
      if (nested !== undefined) return nested
    }
  }
  throw new Error('desktop app build: electron-builder produced no .app bundle')
}

async function electronBuilderCli(): Promise<string> {
  const manifestPath = require.resolve('electron-builder/package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    bin?: string | Record<string, string>
  }
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.['electron-builder']
  if (entry === undefined) throw new Error('desktop app build: electron-builder declares no CLI')
  return resolve(manifestPath, '..', entry)
}

async function runElectronBuilder(args: readonly string[]): Promise<void> {
  const child = spawn(process.execPath, [await electronBuilderCli(), ...args], {
    cwd: appDir,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  })
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>((settle) => {
    let settled = false
    const finish = (result: { code: number | null; signal: NodeJS.Signals | null; error?: Error }): void => {
      if (settled) return
      settled = true
      settle(result)
    }
    child.once('error', error => finish({ code: null, signal: null, error }))
    child.once('exit', (code, signal) => finish({ code, signal }))
  })
  if (exit.error !== undefined) throw exit.error
  if (exit.code !== 0) throw new Error(`desktop app build: electron-builder exited with ${String(exit.code ?? exit.signal)}`)
}

/** Build and publish one double-clickable artifact for the current host platform. */
export async function buildDesktopApp(): Promise<string> {
  await rm(outputDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 })
  await mkdir(outputDir, { recursive: true })
  if (process.platform === 'darwin') {
    await runElectronBuilder(['--mac', '--dir', '--publish', 'never', `--config.directories.output=${outputDir}`])
    const source = await findMacApp(outputDir)
    const target = resolve(repositoryRoot, 'DeepSeek-Harness.app')
    await rm(target, { recursive: true, force: true })
    await cp(source, target, { recursive: true })
    return target
  }

  const windows = process.platform === 'win32'
  const extension = windows ? '.exe' : '.AppImage'
  await runElectronBuilder([
    windows ? '--win' : '--linux',
    windows ? 'portable' : 'AppImage',
    '--publish',
    'never',
    `--config.directories.output=${outputDir}`,
  ])
  const artifacts = (await readdir(outputDir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith(extension))
    .map(entry => join(outputDir, entry.name))
  if (artifacts.length !== 1) {
    throw new Error(`desktop app build: expected one ${extension} artifact, found ${String(artifacts.length)}`)
  }
  const source = artifacts[0]
  if (source === undefined || !(await stat(source)).isFile()) throw new Error('desktop app build: artifact is not a file')
  const target = resolve(repositoryRoot, `DeepSeek-Harness${extension}`)
  await cp(source, target)
  if (!windows) await chmod(target, 0o755)
  return target
}

if (import.meta.main) {
  const artifact = await buildDesktopApp()
  console.log(`desktop app build: wrote ${basename(artifact)} at repository root`)
}
