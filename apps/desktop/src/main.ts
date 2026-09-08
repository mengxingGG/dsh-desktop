/** Electron host for the existing dsh Web application. */

import { app, BrowserWindow, dialog, Menu, session, shell, Tray } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BackendStartupError, startBackend, type BackendHandle, type BackendStartOptions } from './backend.ts'
import { desktopText } from './locales.ts'

const rendererFile = (name: string): string => fileURLToPath(new URL(`../renderer/${name}`, import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))

let backend: BackendHandle | undefined
let mainWindow: BrowserWindow | undefined
let quitting = false
let bootGeneration = 0
let bootAbort: AbortController | undefined
let bootTask: Promise<void> | undefined
let tray: Tray | undefined
let closeChoicePending = false
let exitTask: Promise<void> | undefined

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
    controlPatch: createRequire(cli).resolve('@deepseek-ai/dsh-web-app/desktop.patch.yml'),
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
  const cli = resolve(root, 'apps', 'cli', 'lib', 'bin.js')
  return {
    argsPrefix: ['--expose-internals', cli],
    controlPatch: createRequire(cli).resolve('@deepseek-ai/dsh-web-app/desktop.patch.yml'),
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
  window.on('close', (event) => {
    if (quitting || process.platform !== 'win32') return
    event.preventDefault()
    if (exitTask !== undefined || closeChoicePending) return
    closeChoicePending = true
    void chooseWindowClose(window).catch((error: unknown) => {
      console.error('desktop close dialog failed:', safeErrorMessage(error))
    }).finally(() => { closeChoicePending = false })
  })
  return window
}

async function chooseWindowClose(window: BrowserWindow): Promise<void> {
  const text = desktopText(app.getLocale())
  const choice = await dialog.showMessageBox(window, {
    type: 'question', title: text.closeTitle, message: text.closeMessage, detail: text.closeDetail,
    buttons: [text.hide, text.exit, text.cancel], defaultId: 0, cancelId: 2, noLink: true,
  })
  if (window.isDestroyed() || quitting || exitTask !== undefined) return
  if (choice.response === 0) window.hide()
  else if (choice.response === 1) requestExit()
}

async function confirmActiveStop(): Promise<boolean> {
  const text = desktopText(app.getLocale())
  const options = {
    type: 'warning' as const, title: text.activeTitle, message: text.activeMessage, detail: text.activeDetail,
    buttons: [text.no, text.yes], defaultId: 0, cancelId: 0, noLink: true,
  }
  const choice = mainWindow === undefined ? await dialog.showMessageBox(options) : await dialog.showMessageBox(mainWindow, options)
  return choice.response === 1
}

function finishExit(): void {
  quitting = true
  tray?.destroy()
  tray = undefined
  app.quit()
}

async function exitApplication(): Promise<void> {
  const text = desktopText(app.getLocale())
  tray?.setToolTip(text.checking)
  try {
    // A boot can publish a backend after the window's close request.
    await bootTask
    const running = backend
    if (running !== undefined) {
      let confirmed = false
      if (await running.activity()) {
        if (!await confirmActiveStop()) return
        confirmed = true
      }
      // The backend checks again atomically with starting shutdown, so work
      // admitted after the first inspection cannot skip confirmation.
      if (!await running.shutdown(confirmed)) {
        if (!await confirmActiveStop()) return
        if (!await running.shutdown(true)) throw new Error('desktop shutdown confirmation was rejected')
      }
      backend = undefined
    }
    finishExit()
  } catch (error) {
    restoreMainWindow()
    const options = {
      type: 'error' as const, title: text.failureTitle, message: text.failureMessage,
      detail: `${text.failureDetail}\n\n${safeErrorMessage(error)}`,
      buttons: [text.cancel, text.force], defaultId: 0, cancelId: 0, noLink: true,
    }
    const choice = mainWindow === undefined ? await dialog.showMessageBox(options) : await dialog.showMessageBox(mainWindow, options)
    if (choice.response === 1) {
      bootAbort?.abort()
      await bootTask
      await backend?.stop()
      backend = undefined
      finishExit()
    }
  } finally {
    tray?.setToolTip('DeepSeek Harness')
  }
}

function requestExit(): void {
  if (quitting || exitTask !== undefined) return
  const task = exitApplication()
  exitTask = task
  void task.catch((error: unknown) => {
    dialog.showErrorBox(desktopText(app.getLocale()).failureTitle, safeErrorMessage(error))
  }).finally(() => { if (exitTask === task) exitTask = undefined })
}

async function createTray(): Promise<void> {
  if (process.platform !== 'win32') return
  const icon = await app.getFileIcon(process.execPath, { size: 'small' })
  const text = desktopText(app.getLocale())
  tray = new Tray(icon)
  tray.setToolTip('DeepSeek Harness')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: text.open, click: restoreMainWindow },
    { type: 'separator' },
    { label: text.exit, click: requestExit },
  ]))
  tray.on('click', restoreMainWindow)
  tray.on('double-click', restoreMainWindow)
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
      if (backend !== running || quitting || exitTask !== undefined) return
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

function startWebBackend(): Promise<void> {
  const task = bootWebBackend()
  bootTask = task
  return task.finally(() => {
    if (bootTask === task) bootTask = undefined
  })
}

function restoreMainWindow(): void {
  if (quitting) return
  if (mainWindow === undefined) {
    mainWindow = createMainWindow()
    if (backend === undefined) void startWebBackend()
    else void mainWindow.loadURL(backend.url.href)
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

async function prepareApplication(): Promise<void> {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) })
  session.defaultSession.setPermissionCheckHandler(() => false)
  await createTray()
  mainWindow = createMainWindow()
  await startWebBackend()
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
    if (process.platform !== 'darwin' && tray === undefined) requestExit()
  })
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    requestExit()
  })
}
