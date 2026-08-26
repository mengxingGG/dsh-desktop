/** Stage a plain-Node dsh runtime for the self-contained desktop installer. */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const require = createRequire(import.meta.url)
const appDir = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(appDir, '..', '..')
const backendDir = resolve(appDir, 'dist', 'backend')
const deployedApp = resolve(backendDir, 'app')

async function runPnpm(args: readonly string[]): Promise<void> {
  const entrypoint = process.env.npm_execpath
  if (entrypoint === undefined || entrypoint === '') {
    throw new Error('installer staging requires invocation through pnpm run')
  }
  const child = spawn(process.execPath, [entrypoint, ...args], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  })
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
  if (result.code !== 0) throw new Error(`pnpm deploy exited with ${String(result.code ?? result.signal)}`)
}

function pnpmPackageDir(): string {
  return dirname(require.resolve('pnpm'))
}

async function nodeLicense(): Promise<string> {
  const ref = `v${process.versions.node}`
  const requests: { url: string; headers?: Record<string, string> }[] = [{
    url: `https://api.github.com/repos/nodejs/node/contents/LICENSE?ref=${ref}`,
    headers: {
      Accept: 'application/vnd.github.raw+json',
      'User-Agent': 'deepseek-harness-desktop-builder',
    },
  }, {
    url: `https://raw.githubusercontent.com/nodejs/node/${ref}/LICENSE`,
  }]
  let failure: unknown
  let attempt = 0
  for (const request of requests) {
    for (let retry = 0; retry < 2; retry += 1) {
      attempt += 1
      try {
        const response = await fetch(request.url, {
          ...(request.headers === undefined ? {} : { headers: request.headers }),
          signal: AbortSignal.timeout(30_000),
        })
        if (!response.ok) throw new Error(`HTTP ${String(response.status)} from ${request.url}`)
        return await response.text()
      } catch (error: unknown) {
        failure = error
        await new Promise<void>((resolveDelay) => {
          setTimeout(() => { resolveDelay() }, attempt * 500)
        })
      }
    }
  }
  throw new Error(`Node.js license download failed after ${String(attempt)} attempts`, { cause: failure })
}

async function restoreSpawnHelperMode(): Promise<void> {
  if (process.platform === 'win32') return
  const deployedRequire = createRequire(resolve(deployedApp, 'node_modules', '.pnpm', 'node_modules', 'package.json'))
  const packageRoot = dirname(deployedRequire.resolve('node-pty/package.json'))
  for (const helper of [
    join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
    join(packageRoot, 'build', 'Release', 'spawn-helper'),
  ]) {
    if (existsSync(helper)) await chmod(helper, 0o755)
  }
}

/**
 * Reject links that would point an installed runtime back at its build checkout.
 * @param directory - staged dependency tree copied into the desktop resources.
 */
export async function assertPortableDependencyLinks(directory: string): Promise<void> {
  const root = await realpath(directory)
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) {
        const target = await realpath(path)
        const fromRoot = relative(root, target)
        if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
          throw new Error(`installer staging link leaves the deployed runtime: ${path} -> ${target}`)
        }
      } else if (metadata.isDirectory()) {
        await visit(path)
      }
    }
  }
  await visit(root)
}

/** Create `dist/backend` with Node, the deployed dsh closure, and pnpm. */
export async function prepareInstallerRuntime(): Promise<string> {
  await rm(backendDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 })
  await mkdir(backendDir, { recursive: true })
  await runPnpm([
    '--config.inject-workspace-packages=true',
    '--config.strictDepBuilds=false',
    '--config.node-linker=hoisted',
    '--filter', 'dsh-desktop-runtime',
    'deploy', '--prod', deployedApp,
  ])
  // pnpm rewrites workspace file references to absolute paths during deploy,
  // so its reviewed source-tree allowBuilds key cannot match this one script.
  // Keep every unreviewed script disabled and perform the script's sole effect.
  await restoreSpawnHelperMode()
  await cp(pnpmPackageDir(), resolve(deployedApp, 'node_modules', 'pnpm'), { recursive: true })
  await assertPortableDependencyLinks(deployedApp)
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
  const nodeTarget = resolve(backendDir, nodeName)
  await cp(process.execPath, nodeTarget)
  if (process.platform !== 'win32') await chmod(nodeTarget, 0o755)
  await writeFile(resolve(backendDir, 'LICENSE.node'), await nodeLicense(), 'utf8')
  await writeFile(resolve(backendDir, 'runtime.json'), `${JSON.stringify({ node: process.versions.node }, null, 2)}\n`, 'utf8')

  const manifest = JSON.parse(await readFile(resolve(deployedApp, 'package.json'), 'utf8')) as { name?: unknown }
  if (manifest.name !== 'dsh-desktop-runtime') throw new Error('installer staging produced the wrong deployment package')
  return backendDir
}

if (import.meta.main) {
  const path = await prepareInstallerRuntime()
  console.log(`desktop installer: staged backend at ${path}`)
}
