// Real browser and settings-file persistence coverage without a model request.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFailed } from 'vitest'
import type {} from '@deepseek-ai/dsh-crew'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const HOST_ROOT = fileURLToPath(new URL('../../../packages/bundle/crew-profile', import.meta.url))
const WEB_ROOT = fileURLToPath(new URL('../../../packages/bundle/crew-web-profile', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./snapshots/crew-settings/settings.expected.md', import.meta.url))

it('web e2e: persists Crew roles and editable memory in DSH home across browser reloads', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./crew-panel.overlay.yml', import.meta.url)),
    extraInstallAnchors: [join(WEB_ROOT, 'package.json')],
    agentPresets: {
      roots: [{ path: join(HOST_ROOT, 'presets', 'agents'), trust: 'system' }],
      default: 'crew-manager',
    },
  })
  const browser = await chromium.launch()
  try {
    const page = await newEnglishPage(browser)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-crew-global-settings'))
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    async function openSettings(): Promise<void> {
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Agent orchestration', exact: true }).click()
      await page.locator('[data-crew-settings]').waitFor()
    }

    await openSettings()
    const settings = page.locator('[data-crew-settings]')
    await expect.poll(() => settings.getByRole('button', { name: 'Add memory' }).isEnabled()).toBe(true)
    const catalog = await scaffold.ctx.sessionController.modelCatalog()
    const choices = catalog.groups.flatMap(group => group.models.map(model => ({ provider: group.id, model: model.id })))
    expect(choices.length).toBeGreaterThan(0)
    const roles = [
      ['manager', 'Manager'], ['developer', 'Developer'], ['reviewer', 'Reviewer'], ['integrator', 'Integrator'],
    ] as const
    for (const [index, [role, label]] of roles.entries()) {
      const choice = choices[index % choices.length]!
      const model = settings.getByLabel(`${label} · Model`, { exact: true })
      await model.selectOption(JSON.stringify([choice.provider, choice.model]))
      await expect.poll(() => scaffold.ctx.crewPreferences.snapshot().roles[role]).toEqual(choice)
      await expect.poll(() => model.isEnabled()).toBe(true)
    }

    await settings.getByRole('button', { name: 'Add memory' }).click()
    await settings.getByLabel('Memory content').fill('Explain dependency installation first.')
    await settings.getByLabel('Applies to').fill('All projects')
    await settings.getByRole('button', { name: 'Save memory', exact: true }).click()
    await settings.getByText('Saved in DSH.', { exact: true }).waitFor()
    const document = readFileSync(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(document).toContain('crew-preferences:')
    expect(document).toContain('Explain dependency installation first.')
    expect(document).toContain('kind: preference')
    expect(existsSync(join(scaffold.workspaceCwd, 'settings.yaml'))).toBe(false)

    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openSettings()
    await settings.getByText('Explain dependency installation first.', { exact: true }).waitFor()
    await settings.getByRole('button', { name: 'Edit', exact: true }).click()
    await settings.getByLabel('Memory content').fill('Do not automatically delete files.')
    await settings.getByRole('button', { name: 'Save memory', exact: true }).click()
    await settings.locator('li p').getByText('Do not automatically delete files.', { exact: true }).waitFor()
    await settings.getByLabel('Memory content').waitFor({ state: 'hidden' })
    await expect.poll(() => settings.getByRole('button', { name: 'Add memory' }).isEnabled()).toBe(true)
    await compareOrRefreshGolden(EXPECTED,
      await captureStableAria(page, '[data-crew-settings]', scaffold.workspaceCwd), webSnapshotMode())
    await settings.screenshot({ path: fileURLToPath(new URL('../../../.run/crew-global-settings.png', import.meta.url)) })

    await settings.getByRole('button', { name: 'Delete', exact: true }).click()
    await settings.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(Object.keys(scaffold.ctx.crewPreferences.snapshot().memory)).toHaveLength(1)
    await settings.getByRole('button', { name: 'Delete', exact: true }).click()
    await settings.getByRole('button', { name: 'Confirm memory deletion', exact: true }).click()
    await settings.getByText('No global memory yet.', { exact: true }).waitFor()
    expect(Object.keys(scaffold.ctx.crewPreferences.snapshot().memory)).toHaveLength(0)
    expect(readFileSync(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')).not.toContain('Do not automatically delete files.')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  } finally {
    await browser.close()
    await scaffold.close()
  }
}, 120_000)
