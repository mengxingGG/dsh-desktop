import type { DesktopHostProcess } from '../src/host-process.ts'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (...args: unknown[]) => void>(),
  windowListeners: new Map<string, (...args: unknown[]) => void>(),
  trayListeners: new Map<string, () => void>(),
  menu: [] as Array<{ label?: string; click?: () => void }>,
  quit: vi.fn(), startBackend: vi.fn(), dialog: vi.fn<(...args: unknown[]) => Promise<{ response: number }>>(),
  tray: { setToolTip: vi.fn<(text: string) => void>(), setContextMenu: vi.fn(), destroy: vi.fn() },
  window: {
    loadFile: vi.fn().mockResolvedValue(undefined), loadURL: vi.fn().mockResolvedValue(undefined),
    isDestroyed: () => false, isMinimized: () => false,
    hide: vi.fn(), show: vi.fn(), focus: vi.fn(), restore: vi.fn(),
    webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn(), send: vi.fn(), openDevTools: vi.fn() },
  },
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false, requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(),
    getLocale: () => 'zh-CN', getFileIcon: () => Promise.resolve({}),
    getVersion: () => '0.1.3-alpha.2',
    on: (name: string, listener: (...args: unknown[]) => void) => { mocks.listeners.set(name, listener) },
    quit: mocks.quit,
  },
  BrowserWindow: Object.assign(function () {
    return {
      ...mocks.window,
      on: (name: string, listener: (...args: unknown[]) => void) => { mocks.windowListeners.set(name, listener) },
      once: (name: string, listener: (...args: unknown[]) => void) => { mocks.windowListeners.set(name, listener) },
    }
  }, { getAllWindows: () => [] }),
  Tray: function () {
    return { ...mocks.tray, on: (name: string, listener: () => void) => { mocks.trayListeners.set(name, listener) } }
  },
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: (menu: typeof mocks.menu) => { mocks.menu = menu; return menu } },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  ipcMain: { handle: vi.fn() },
  session: { defaultSession: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() } },
  dialog: { showErrorBox: vi.fn(), showMessageBox: mocks.dialog }, shell: {},
}))

vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
  existsSync: () => true,
}))

vi.mock('../src/host-process.ts', () => ({
  DesktopHostProcess: class {
    async start() { Object.assign(this, await mocks.startBackend()) }
  },
}))
vi.mock('../src/project-manager.ts', () => ({
  DesktopProjectManager: class {
    recover() {}
    async applyRelease() {}
  },
}))
vi.mock('../src/update-coordinator.ts', () => ({
  DesktopUpdateCoordinator: class {
    async check() { return { phase: 'idle' } }
  },
}))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const resourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
beforeEach(() => {
  // These tests exercise Windows shell decisions without calling native APIs.
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
  vi.stubEnv('DSH_DESKTOP_DEV_PROJECT_DIR', '')
  vi.stubEnv('DSH_DESKTOP_OPEN_DEVTOOLS', '0')
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: 'C:/desktop-resources' })
})
afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  if (resourcesPath === undefined) Reflect.deleteProperty(process, 'resourcesPath')
  else Object.defineProperty(process, 'resourcesPath', resourcesPath)
  vi.unstubAllEnvs()
  mocks.listeners.clear(); mocks.windowListeners.clear(); mocks.trayListeners.clear(); mocks.menu = []
  vi.clearAllMocks(); mocks.startBackend.mockReset(); mocks.dialog.mockReset(); vi.resetModules()
})

function runningBackend(busy = false) {
  return {
    activity: vi.fn().mockResolvedValue(busy), shutdown: vi.fn().mockResolvedValue(true), stop: vi.fn().mockResolvedValue(undefined),
  } satisfies Pick<DesktopHostProcess, 'activity' | 'shutdown' | 'stop'>
}

async function boot(backend = runningBackend()) {
  mocks.startBackend.mockResolvedValue(backend)
  await import('../src/main.ts')
  await expect.poll(() => mocks.window.loadURL.mock.calls.length).toBe(1)
  await expect.poll(() => mocks.menu.some(item => item.label === '彻底退出')).toBe(true)
  return backend
}

function closeWindow(): void {
  const listener = mocks.windowListeners.get('close')
  if (listener === undefined) throw new Error('desktop has no window-close listener')
  const preventDefault = vi.fn()
  listener({ preventDefault })
  expect(preventDefault).toHaveBeenCalledOnce()
}

function exitFromTray(): void {
  const action = mocks.menu.find(item => item.label === '彻底退出')?.click
  if (action === undefined) throw new Error('desktop tray has no exit action')
  action()
}

it('hides to the tray without interrupting tasks and restores the same window', async () => {
  const backend = await boot(runningBackend(true))
  mocks.dialog.mockResolvedValue({ response: 0 })
  closeWindow()
  await expect.poll(() => mocks.window.hide.mock.calls.length).toBe(1)
  expect(backend.activity).not.toHaveBeenCalled()
  expect(backend.shutdown).not.toHaveBeenCalled()
  expect(backend.stop).not.toHaveBeenCalled()
  expect(mocks.quit).not.toHaveBeenCalled()
  mocks.trayListeners.get('click')?.()
  expect(mocks.window.show).toHaveBeenCalledOnce()
  expect(mocks.window.focus).toHaveBeenCalledOnce()
  expect(mocks.startBackend).toHaveBeenCalledOnce()
})

it('leaves active tasks running when the second confirmation is declined', async () => {
  const backend = await boot(runningBackend(true))
  mocks.dialog.mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 0 })
  closeWindow()
  await expect.poll(() => mocks.dialog.mock.calls.length).toBe(2)
  await expect.poll(() => mocks.tray.setToolTip.mock.calls.at(-1)?.[0]).toBe('DeepSeek Harness')
  expect(backend.shutdown).not.toHaveBeenCalled()
  expect(backend.stop).not.toHaveBeenCalled()
  expect(mocks.window.hide).not.toHaveBeenCalled()
  expect(mocks.quit).not.toHaveBeenCalled()
  expect(mocks.dialog.mock.calls[1]?.[0]).toMatchObject({ defaultId: 0, cancelId: 0 })
})

it('waits for confirmed task shutdown and persistence before removing the tray and exiting', async () => {
  const backend = runningBackend(true)
  const saved = Promise.withResolvers<boolean>()
  vi.mocked(backend.shutdown).mockReturnValue(saved.promise)
  await boot(backend)
  mocks.dialog.mockResolvedValue({ response: 1 })
  exitFromTray()
  try {
    await expect.poll(() => vi.mocked(backend.shutdown).mock.calls.length).toBe(1)
    expect(backend.shutdown).toHaveBeenCalledWith(true)
    expect(mocks.quit).not.toHaveBeenCalled()
    expect(mocks.tray.destroy).not.toHaveBeenCalled()
    expect(backend.stop).not.toHaveBeenCalled()
  } finally {
    saved.resolve(true)
    await expect.poll(() => mocks.quit.mock.calls.length).toBe(1)
  }
  expect(mocks.tray.destroy).toHaveBeenCalledOnce()
})

it('exits an idle backend without claiming that merely open Sessions are active tasks', async () => {
  const backend = await boot()
  exitFromTray()
  await expect.poll(() => mocks.quit.mock.calls.length).toBe(1)
  expect(mocks.dialog).not.toHaveBeenCalled()
  expect(backend.shutdown).toHaveBeenCalledWith(false)
})

it('asks again if work starts between inspection and the shutdown request', async () => {
  const backend = runningBackend()
  vi.mocked(backend.shutdown).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  await boot(backend)
  mocks.dialog.mockResolvedValue({ response: 1 })
  exitFromTray()
  await expect.poll(() => mocks.quit.mock.calls.length).toBe(1)
  expect(mocks.dialog).toHaveBeenCalledOnce()
  expect(vi.mocked(backend.shutdown).mock.calls).toEqual([[false], [true]])
})

it('keeps a failed save visible and never silently force-kills the backend', async () => {
  const backend = runningBackend()
  vi.mocked(backend.shutdown).mockRejectedValue(new Error('save failed'))
  await boot(backend)
  mocks.dialog.mockResolvedValue({ response: 0 })
  exitFromTray()
  await expect.poll(() => mocks.dialog.mock.calls.length).toBe(1)
  await expect.poll(() => mocks.tray.setToolTip.mock.calls.at(-1)?.[0]).toBe('DeepSeek Harness')
  expect(backend.stop).not.toHaveBeenCalled()
  expect(mocks.quit).not.toHaveBeenCalled()
})

it('coalesces repeated window-close requests while the choice remains open', async () => {
  await boot()
  const choice = Promise.withResolvers<{ response: number }>()
  mocks.dialog.mockReturnValue(choice.promise)
  closeWindow(); closeWindow()
  expect(mocks.dialog).toHaveBeenCalledOnce()
  choice.resolve({ response: 2 })
  await Promise.resolve()
  expect(mocks.window.hide).not.toHaveBeenCalled()
  expect(mocks.quit).not.toHaveBeenCalled()
})

it('publishes the tray only after the official Host is ready', async () => {
  const started = Promise.withResolvers<undefined>()
  const launch = Promise.withResolvers<ReturnType<typeof runningBackend>>()
  mocks.startBackend.mockImplementation(() => { started.resolve(undefined); return launch.promise })
  await import('../src/main.ts')
  await started.promise
  expect(mocks.menu.some(item => item.label === '彻底退出')).toBe(false)
  expect(mocks.quit).not.toHaveBeenCalled()
  const backend = runningBackend(true)
  mocks.dialog.mockResolvedValue({ response: 0 })
  launch.resolve(backend)
  await expect.poll(() => mocks.menu.some(item => item.label === '彻底退出')).toBe(true)
  exitFromTray()
  await expect.poll(() => mocks.dialog.mock.calls.length).toBe(1)
  await expect.poll(() => mocks.tray.setToolTip.mock.calls.at(-1)?.[0]).toBe('DeepSeek Harness')
  expect(backend.shutdown).not.toHaveBeenCalled()
  expect(backend.stop).not.toHaveBeenCalled()
  expect(mocks.quit).not.toHaveBeenCalled()
})
