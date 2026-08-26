/** Electron host for the existing dsh Web application. */

import { app, BrowserWindow, dialog, session, shell } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BackendStartupError, startBackend, type BackendHandle, type BackendStartOptions } from './backend.ts'

const rendererFile = (name: string): string => fileURLToPath(new URL(`../renderer/${name}`, import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))

let backend: BackendHandle | undefined
let mainWindow: BrowserWindow | undefined
let quitting = false
let bootGeneration = 0
let bootAbort: AbortController | undefined

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resolveCheckoutRoot(): string {
  const appImage = process.env.APPIMAGE
  const candidates = [
    process.env.DSH_DESKTOP_PROJECT_ROOT,
    process.env.PORTABLE_EXECUTABLE_DIR,
    appImage === undefined ? undefined : dirname(appImage),
    process.cwd(),
    repositoryRoot,
    app.isPackaged ? resolve(app.getAppPath(), '..', '..', '..', '..') : undefined,
  ]
  const tried: string[] = []
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === '') continue
    const root = resolve(candidate)
    if (tried.includes(root)) continue
    tried.push(root)
    if (existsSync(resolve(root, 'package.json')) && existsSync(resolve(root, 'apps', 'cli', 'lib', 'bin.js'))) {
      return root
    }
  }
  throw new Error(`desktop shell cannot find a built DeepSeek Harness checkout; searched: ${tried.join(', ')}`)
}

function resolveNodeExecutable(): string {
  const configured = process.env.DSH_DESKTOP_NODE
  if (configured !== undefined && configured !== '') return configured
  const packageManagerNode = process.env.npm_node_execpath
  if (packageManagerNode !== undefined && packageManagerNode !== '' && existsSync(packageManagerNode)) {
    return packageManagerNode
  }
  return process.platform === 'win32' ? 'node.exe' : 'node'
}

function bundledRuntime(): BackendStartOptions & { readonly argsPrefix: readonly string[]; readonly cwd: string } | undefined {
  if (!app.isPackaged) return undefined
  const backend = resolve(process.resourcesPath, 'backend')
  const executable = resolve(backend, process.platform === 'win32' ? 'node.exe' : 'node')
  const cli = resolve(backend, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const pnpmManifest = resolve(backend, 'app', 'node_modules', 'pnpm', 'package.json')
  if (!existsSync(executable) || !existsSync(cli) || !existsSync(pnpmManifest)) return undefined
  const manifest = JSON.parse(readFileSync(pnpmManifest, 'utf8')) as { bin?: string | Record<string, string> }
  const pnpmEntry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.pnpm
  if (pnpmEntry === undefined) throw new Error('bundled pnpm package declares no pnpm executable')
  return {
    executable,
    argsPrefix: ['--expose-internals', cli],
    cwd: app.getPath('home'),
    environment: {
      ...process.env,
      npm_execpath: resolve(backend, 'app', 'node_modules', 'pnpm', pnpmEntry),
      npm_node_execpath: executable,
    },
  }
}

function dshRuntime(): BackendStartOptions & { readonly argsPrefix: readonly string[]; readonly cwd: string } {
  const bundled = bundledRuntime()
  if (bundled !== undefined) return bundled
  const root = resolveCheckoutRoot()
  return {
    argsPrefix: ['--expose-internals', resolve(root, 'apps', 'cli', 'lib', 'bin.js')],
    cwd: root,
    environment: process.env,
    executable: resolveNodeExecutable(),
  }
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#f5f5f3',
    show: true,
    title: 'DeepSeek Harness',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    void confirmExternalUrl(window, url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (backend !== undefined && new URL(url).origin === backend.url.origin) return
    event.preventDefault()
    void confirmExternalUrl(window, url)
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  return window
}

async function confirmExternalUrl(parent: BrowserWindow, raw: string): Promise<void> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return
  const choice = await dialog.showMessageBox(parent, {
    type: 'question',
    buttons: ['取消', '在浏览器中打开'],
    defaultId: 0,
    cancelId: 0,
    title: '打开外部链接',
    message: '是否在系统浏览器中打开此链接？',
    detail: url.href,
  })
  if (choice.response === 1) await shell.openExternal(url.href)
}


async function showBackendFailure(error: unknown, logs = ''): Promise<void> {
  const window = mainWindow
  if (window === undefined || window.isDestroyed()) return
  await window.loadFile(rendererFile('backend-error.html'), {
    query: {
      message: safeErrorMessage(error),
      logs,
    },
  })
}

async function bootWebBackend(): Promise<void> {
  const generation = ++bootGeneration
  bootAbort?.abort()
  const abort = new AbortController()
  bootAbort = abort
  const window = mainWindow
  if (window !== undefined && !window.isDestroyed()) await window.loadFile(rendererFile('loading.html'))
  const previous = backend
  backend = undefined
  if (previous !== undefined) await previous.stop()
  try {
    const running = await startBackend({ ...dshRuntime(), signal: abort.signal })
    if (generation !== bootGeneration || quitting) {
      await running.stop()
      return
    }
    backend = running
    const current = mainWindow
    if (current !== undefined && !current.isDestroyed()) await current.loadURL(running.url.href)
    void running.exited.then((exit) => {
      if (backend !== running || quitting) return
      backend = undefined
      void showBackendFailure(
        exit.error ?? new Error(`dsh web 已停止（${String(exit.exitCode ?? exit.signal)}）`),
        running.logs(),
      )
    })
  } catch (error) {
    if (generation === bootGeneration && !quitting) {
      await showBackendFailure(error, error instanceof BackendStartupError ? error.logs : '')
    }
  } finally {
    if (bootAbort === abort) bootAbort = undefined
  }
}

function restoreMainWindow(): void {
  if (mainWindow === undefined) {
    mainWindow = createMainWindow()
    if (backend === undefined) void bootWebBackend()
    else void mainWindow.loadURL(backend.url.href)
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

async function prepareApplication(): Promise<void> {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) })
  session.defaultSession.setPermissionCheckHandler(() => false)
  mainWindow = createMainWindow()
  await bootWebBackend()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    restoreMainWindow()
  })
  app.whenReady().then(prepareApplication).catch((error: unknown) => {
    dialog.showErrorBox('DeepSeek Harness 启动失败', safeErrorMessage(error))
    app.quit()
  })
  app.on('activate', () => {
    restoreMainWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    bootAbort?.abort()
    const running = backend
    backend = undefined
    void (running?.stop() ?? Promise.resolve()).finally(() => { app.quit() })
  })
}
