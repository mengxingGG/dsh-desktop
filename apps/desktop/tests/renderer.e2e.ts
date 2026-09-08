/** Native Windows acceptance for the built Electron preload and profile composition. */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { expect, it } from 'vitest'
import { prepareDevelopmentProject } from '../scripts/development-project.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'

const desktopRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const require = createRequire(new URL('../package.json', import.meta.url))

it.skipIf(process.platform !== 'win32')('loads sandboxed bridges and selects the shipped orchestration Agent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-renderer-'))
  let app: ElectronApplication | undefined
  try {
    const cli = JSON.parse(await readFile(join(repoRoot, 'apps/cli/package.json'), 'utf8')) as { version: string }
    const projectDir = prepareDevelopmentProject({
      projectDir: join(root, 'project'),
      cliDir: join(repoRoot, 'apps/cli'),
      hostDir: join(repoRoot, 'apps/desktop-host'),
      dependencyDir: join(repoRoot, 'node_modules/.pnpm/node_modules'),
      release: {
        schemaVersion: 1,
        version: cli.version,
        hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
        nodeVersion: process.versions.node,
        pnpmVersion: '11.7.0',
      },
    })
    const inheritedEnv = Object.fromEntries(
      Object.entries(process.env).flatMap(([key, value]) => value === undefined ? [] : [[key, value]]),
    )
    const env: Record<string, string> = { ...inheritedEnv, DSH_HOME: join(root, 'home'), DSH_AGENTS_HOME: join(root, 'agents'),
      DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: '', DSH_DESKTOP_DEV_PROJECT_DIR: projectDir,
      DSH_DESKTOP_NODE_BINARY: process.execPath, DSH_DESKTOP_OPEN_DEVTOOLS: '0' }
    delete env.ELECTRON_RUN_AS_NODE
    const executablePath: unknown = require('electron')
    if (typeof executablePath !== 'string') throw new Error('Electron executable path is missing')
    app = await electron.launch({ executablePath, args: [`--user-data-dir=${join(root, 'electron')}`, '--lang=en-US', desktopRoot], env, timeout: 30_000 })
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.stack ?? error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' || /Unable to load preload|module not found/.test(message.text())) errors.push(message.text())
    })
    await page.waitForURL('dsh-app://app/index.html')
    await page.reload()
    await page.waitForFunction(() => 'dshDesktop' in window)
    expect(await page.evaluate(() => {
      const bridge = (window as unknown as { dshDesktop: { protocolVersion: number; openPluginManager: unknown } }).dshDesktop
      return [bridge.protocolVersion, typeof bridge.openPluginManager]
    })).toEqual([1, 'function'])
    await page.getByRole('button', { name: /^(Continue|继续)$/ }).click()
    await page.getByRole('button', { name: /^(Configure later|稍后配置)$/ }).click()
    await page.getByRole('button', { name: /^(Standard mode|标准模式)$/ }).click().catch(async (error: unknown) => {
      throw new Error(`${String(error)}\n${await page.locator('body').innerText()}\n${errors.join('\n')}`)
    })
    await page.getByRole('menuitem', { name: /Orchestration mode|编排模式/ }).click()
    await page.getByRole('button', { name: /^(Orchestration mode|编排模式)$/ }).waitFor()
    await page.getByRole('button', { name: /^(Settings|设置)$/ }).click().catch(async (error: unknown) => {
      throw new Error(`${String(error)}\n${await page.locator('body').innerText()}\n${errors.join('\n')}`)
    })
    const settings = page.getByRole('dialog', { name: /^(Settings|设置)$/ })
    await settings.getByRole('button', { name: /^(Agent presets|Agent 预设)$/ }).click()
    await settings.getByRole('button', { name: /^(View: Orchestration mode|查看: 编排模式)$/ }).waitFor()
    expect(errors).toEqual([])

    const [managementPage] = await Promise.all([
      app.waitForEvent('window'),
      app.evaluate(async ({ BrowserWindow }, preload) => {
        const window = new BrowserWindow({
          show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
        })
        await window.loadURL('dsh-app://shell/plugin-manager.html')
      }, join(desktopRoot, 'lib/preload.cjs')),
    ])
    await managementPage.waitForFunction(() => 'dshDesktop' in window)
    expect(await managementPage.evaluate(() => {
      const bridge = (window as unknown as { dshDesktop: { protocolVersion: number; plugins: { list: unknown } } }).dshDesktop
      return [bridge.protocolVersion, typeof bridge.plugins.list]
    })).toEqual([1, 'function'])
  } finally {
    await app?.close()
    await rm(root, { recursive: true, force: true })
  }
})
