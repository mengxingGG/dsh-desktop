// Keyless assembled-browser coverage for the native Crew profiles over
// the real Session projection and typed Chat details-view chain.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, onTestFinished } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-team'
import type {} from '@deepseek-ai/dsh-crew'
import { createMessage, createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  parseSeedFixture,
  realizeSeedFixture,
  seedSession,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/crew-panel', import.meta.url))
const PANEL_EXPECTED = join(SNAPSHOT_DIR, 'panel.expected.md')
const PANEL_ZH_EXPECTED = join(SNAPSHOT_DIR, 'panel.zh.expected.md')
const OVERLAY = fileURLToPath(new URL('./crew-panel.overlay.yml', import.meta.url))
const HOST_ROOT = fileURLToPath(new URL('../../../packages/bundle/crew-profile', import.meta.url))
const WEB_ROOT = fileURLToPath(new URL('../../../packages/bundle/crew-web-profile', import.meta.url))
const HOST_PATCH = join(HOST_ROOT, 'cordis.patch.yml')
const WEB_PATCH = join(WEB_ROOT, 'cordis.patch.yml')
// The Web layer depends on the Host layer. Treating only the outer bundle as
// the install anchor mirrors production and leaves the Host bundle available
// to the profile as a runtime preset provider.
const INSTALL_ANCHORS = [join(WEB_ROOT, 'package.json')]
const MODE = webSnapshotMode()
const WORKSPACE_NAME = 'crew-project'
const EVIDENCE_DIR = fileURLToPath(new URL('../../../snapshots/web/crew-command-evidence', import.meta.url))
const CREW_FIXTURE = fileURLToPath(new URL('../../../snapshots/crew-native/two-module/session.v2.jsonl', import.meta.url))
const EVIDENCE_SESSION_ID = 'crew-command-evidence'

function launchCrewScaffold(managerPreset = true): Promise<WebScaffold> {
  return launchWebScaffold({
    extraOverlayPath: OVERLAY,
    extraInstallAnchors: INSTALL_ANCHORS,
    ...managerPreset ? { agentPresets: {
      roots: [{ path: join(HOST_ROOT, 'presets', 'agents'), trust: 'system' }],
      default: 'crew-manager',
    } } : {},
  })
}

function profileEntries(path: string): unknown[] {
  const parsed = yaml.load(readFileSync(path, 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new Error(`profile layer at ${path} must be a list`)
  return parsed
}

function comparable(value: unknown): unknown {
  if (typeof value === 'function') return String(value)
  if (Array.isArray(value)) return value.map(comparable)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, comparable(item)]))
  }
  return value
}

describe('native Crew panel overlay', () => {
  it('matches the shipped Host and Web profile layers', () => {
    expect(comparable(profileEntries(OVERLAY))).toEqual(comparable([
      ...profileEntries(HOST_PATCH),
      ...profileEntries(WEB_PATCH),
    ]))
  })
})

/** Holds a real child stream until the browser has observed its first delta. */
class CrewActivityAdapter extends LlmAdapter {
  // Annotated binding (not withResolvers<void>()): the tests lint layer runs
  // no-invalid-void-type with default options, which rejects the explicit
  // type argument in call position but accepts the inferred form.
  readonly release: PromiseWithResolvers<void> = Promise.withResolvers()
  calls = 0

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    const signal = options.signal
    if (signal === undefined) throw new Error('Crew activity fixture requires a turn signal')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Worker live prefix' }
    let abort: () => void = () => {}
    try {
      await Promise.race([
        this.release.promise,
        new Promise<never>((_resolve, reject) => {
          abort = () => {
            const reason: unknown = signal.reason
            reject(reason instanceof Error ? reason : new Error('Crew activity fixture aborted', { cause: reason }))
          }
          if (signal.aborted) abort()
          else signal.addEventListener('abort', abort, { once: true })
        }),
      ])
    } finally {
      signal.removeEventListener('abort', abort)
    }
    signal.throwIfAborted()
    yield { type: 'text-delta', index: 0, text: ' and completed suffix.' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Worker live prefix and completed suffix.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('web e2e: live Crew child records', () => {
  it('observes a running child without selecting it and reloads its settled history', async () => {
    const scaffold = await launchCrewScaffold(false)
    const adapter = new CrewActivityAdapter()
    let browser: Browser | undefined
    try {
      scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter(['crew-activity-test'], adapter))
      browser = await chromium.launch()
      const page = await newEnglishPage(browser)
      const tripwire = watchConsole(page)
      onTestFailed(() => saveFailureShot(page, 'web-e2e-crew-live-records'))
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await connectFreshWorkspace(page, scaffold.workspaceCwd, 'crew-live')
      const manager = scaffold.ctx.agents.list()[0]!
      const prompt = await scaffold.ctx.systemPrompt.assemble({ agent: manager, scope: manager })
      expect(prompt.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(['read', 'write', 'skill', 'crew_dispatch']))
      agentEvents(scaffold.ctx, manager).emit('agent/status', { status: 'running' })
      manager.session.append('turn/start', { turn: 1 })
      manager.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'Manage this project with the native Crew.' }], source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      manager.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      agentEvents(scaffold.ctx, manager).emit('agent/status', { status: 'idle' })
      await scaffold.ctx.sessions.flush(manager.session)
      await scaffold.ctx.crew.ensureConfigured(manager)
      const task = await scaffold.ctx.agentTeams.createTask(manager, {
        subject: 'Live module', description: 'Observe a live child Session.', writeScopes: ['modules/live'],
      })
      const work = await scaffold.ctx.crew.createWorkItem(manager, {
        taskId: task.id, moduleKey: 'live-module', specPath: 'docs/live.md', specRevision: 1,
        readScopes: ['docs', 'modules/live'], writeScopes: ['modules/live'], requiredArtifacts: [], testCommands: [],
        baseline: { head: 'fixture-head', branch: 'main', statusDigest: 'clean', changedPaths: [], stagedPaths: [], pathDigests: {} },
      })
      const child = await scaffold.ctx.agentTeams.spawnTeammate(manager, {
        name: 'live-developer', description: 'Child output fixture',
        prompt: [{ type: 'text', text: 'Produce a streamed progress record.' }],
        context: 'fresh', provider: 'spawn', agentOptions: { provider: 'crew-activity-test', model: 'held' },
        signal: new AbortController().signal,
      })
      await scaffold.ctx.crew.updateWorkItem(manager, {
        taskId: task.id, expectedRevision: work.revision, stage: 'queued', developerName: 'live-developer',
        developerSessionId: child.member.id, appendWorkerSessionId: child.member.id,
      })
      await page.getByRole('button', { name: 'Open Crew workspace' }).click()
      const panel = page.locator('[data-crew-details]')
      const activity = panel.locator('[data-crew-activity]')
      await activity.getByText('Worker live prefix', { exact: true }).waitFor({ timeout: 15_000 })
      expect(scaffold.ctx.agents.get(child.member.id)?.status).toBe('running')
      expect(await panel.locator('input, textarea, [contenteditable]').count()).toBe(0)
      expect(await page.locator('[data-composer-input][contenteditable="true"]').count()).toBe(1)
      expect(manager.status).toBe('idle')
      adapter.release.resolve()
      await activity.getByText('Worker live prefix and completed suffix.', { exact: true }).waitFor()
      await expect.poll(() => scaffold.ctx.agentTeams.listMembers(manager).find(member => member.id === child.member.id)?.status).toBe('inactive')
      await scaffold.ctx.sessions.flush(manager.session)
      const expectedDir = fileURLToPath(new URL('./snapshots/crew-activity', import.meta.url))
      await compareOrRefreshGolden(join(expectedDir, 'settled.expected.md'),
        await captureStableAria(page, '[data-crew-activity]', scaffold.workspaceCwd), MODE)
      await page.screenshot({ path: fileURLToPath(new URL('../../../.run/crew-live-layout.png', import.meta.url)) })
      await panel.getByRole('button', { name: 'Close Crew workspace' }).click()
      await panel.waitFor({ state: 'hidden' })
      await page.reload({ waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await page.getByRole('button', { name: 'Open Crew workspace' }).click()
      await activity.getByText('Worker live prefix and completed suffix.', { exact: true }).waitFor({ timeout: 15_000 })
      expect(await activity.getByText('Worker live prefix and completed suffix.', { exact: true }).count()).toBe(1)
      expect(adapter.calls).toBe(1)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
      if (MODE !== 'record') await assertFixtureInventory(expectedDir, ['settled.expected.md'])
    } finally {
      adapter.release.resolve()
      try { await browser?.close() } finally { await scaffold.close() }
    }
  }, 90_000)
})

describe('web e2e: native Crew panel', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchCrewScaffold()
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd, WORKSPACE_NAME)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('streams a durable work item, keeps workers read-only, and reconstructs it after reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-crew-panel'))
    const agent = scaffold.ctx.agents.list()[0]
    if (agent === undefined) throw new Error('connected Crew workspace did not create a manager Agent')
    await scaffold.ctx.crew.ensureConfigured(agent)
    agentEvents(scaffold.ctx, agent).emit('agent/status', { status: 'running' })
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Open the Crew workspace.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('assistant/message', {
      stream: [],
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'Crew ready.' }],
        source: { kind: 'model', provider: 'fixture', model: 'fixture' },
      }),
    }, { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    agentEvents(scaffold.ctx, agent).emit('agent/status', { status: 'idle' })
    await scaffold.ctx.sessions.flush(agent.session)
    await page.getByText('Crew ready.').waitFor({ timeout: 10_000 })

    await page.getByRole('button', { name: 'Open Crew workspace' }).click()
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await page.locator('[data-crew-details]').getByText('No active workers').waitFor()

    const task = await scaffold.ctx.agentTeams.createTask(agent, {
      subject: 'Browser module',
      description: 'Exercise the live native Crew projection.',
      writeScopes: ['modules/browser'],
    })
    await scaffold.ctx.crew.createWorkItem(agent, {
      taskId: task.id,
      moduleKey: 'browser-module',
      specPath: 'specs/browser-v1.md',
      specRevision: 1,
      readScopes: ['specs', 'modules/browser'],
      writeScopes: ['modules/browser'],
      requiredArtifacts: ['modules/browser/index.ts'],
      testCommands: [{
        id: 'browser-unit',
        argv: ['node', '--test', 'index.test.mjs'],
        cwd: 'modules/browser',
        timeoutMs: 10_000,
      }],
      baseline: {
        head: 'fixture-head',
        branch: 'main',
        statusDigest: 'fixture-clean',
        changedPaths: [],
        stagedPaths: [],
        pathDigests: {},
      },
    })

    const panel = page.locator('[data-crew-details]')
    await panel.getByText('browser-module', { exact: true }).first().waitFor()
    expect(await panel.getByRole('textbox').count()).toBe(0)
    expect(await page.locator('[data-composer-input][contenteditable="true"]').count()).toBe(1)

    const snapshot = await captureStableAria(page, '[data-crew-details]', join(scaffold.workspaceCwd, WORKSPACE_NAME))
    await compareOrRefreshGolden(PANEL_EXPECTED, snapshot, MODE)

    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    if (await page.locator('[data-crew-details]').count() === 0) {
      await page.getByRole('button', { name: 'Open Crew workspace' }).click()
    }
    await page.locator('[data-crew-details]').getByText('browser-module', { exact: true }).first().waitFor()
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('keeps the narrow panel keyboard-operable and exposes the same evidence in Chinese', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-crew-panel-accessibility'))
    await page.setViewportSize({ width: 1020, height: 800 })
    const panel = page.locator('[data-crew-details]')
    const close = panel.getByRole('button', { name: 'Close Crew workspace' })
    await close.focus()
    await close.press('Enter')
    await panel.waitFor({ state: 'hidden' })

    const trigger = page.getByRole('button', { name: 'Open Crew workspace' })
    await trigger.focus()
    await trigger.press('Enter')
    await panel.waitFor()
    const worker = panel.getByRole('button', { name: /browser-module/u })
    await worker.focus()
    await worker.press('Enter')
    expect(await worker.getAttribute('aria-pressed')).toBe('true')
    const bounds = await panel.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1020)
    expect(await panel.getByText('Planned', { exact: true }).count()).toBeGreaterThan(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])

    await panel.getByRole('button', { name: 'Close Crew workspace' }).press('Enter')
    await panel.waitFor({ state: 'hidden' })
    await page.setViewportSize({ width: 1680, height: 1000 })
    const settings = page.getByRole('button', { name: 'Settings', exact: true })
    await settings.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('button', { name: 'English' }).click()
    await page.getByRole('menuitem', { name: '中文' }).click()
    await page.getByRole('dialog', { name: '设置' }).waitFor({ timeout: 10_000 })
    await page.keyboard.press('Escape')

    const zhTrigger = page.getByRole('button', { name: '打开 Crew 工作台' })
    await zhTrigger.focus()
    await zhTrigger.press('Enter')
    await panel.getByText('browser-module', { exact: true }).first().waitFor()
    expect(await panel.getByRole('textbox').count()).toBe(0)
    expect(await page.locator('[data-composer-input][contenteditable="true"]').count()).toBe(1)
    expect(await panel.getByText('已规划', { exact: true }).count()).toBeGreaterThan(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    const snapshot = await captureStableAria(page, '[data-crew-details]', join(scaffold.workspaceCwd, WORKSPACE_NAME))
    await compareOrRefreshGolden(PANEL_ZH_EXPECTED, snapshot, MODE)
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['panel.expected.md', 'panel.zh.expected.md'])
  })
})

describe.skipIf(MODE === 'record')('web e2e: recorded Crew command evidence', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let recordedStdout: string
  let recordedCommitHash: string

  beforeAll(async () => {
    scaffold = await launchCrewScaffold()
    const fixture = readFileSync(CREW_FIXTURE, 'utf8')
    const { events } = parseSeedFixture(realizeSeedFixture(scaffold, fixture, EVIDENCE_SESSION_ID))
    const integration = events.findLast(event => event.type === 'crew/integration')
    if (integration?.type !== 'crew/integration' || integration.data.integration.status !== 'passed') {
      throw new Error('Crew recording must contain a completed integration')
    }
    recordedStdout = integration.data.integration.commands[0]!.stdout
    const commit = events.findLast(event => event.type === 'crew/commit')
    if (commit?.type !== 'crew/commit' || commit.data.commit.commitHash === undefined) {
      throw new Error('Crew recording must contain a committed hash')
    }
    recordedCommitHash = commit.data.commit.commitHash
    await seedSession(scaffold, fixture, EVIDENCE_SESSION_ID, 'crew-manager')
    browser = await chromium.launch()
  })

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      await scaffold?.close()
    }
  })

  it.each([
    { language: 'English', locale: 'en-US', open: 'Open Crew workspace', stdout: 'Standard output',
      file: 'evidence.expected.md', empty: 'No output', inputs: 'Included work items', round: 'Review round' },
    { language: 'Chinese', locale: 'zh-CN', open: '打开 Crew 工作台', stdout: '标准输出',
      file: 'evidence.zh.expected.md', empty: '无输出', inputs: '包含的工单', round: '审查轮次' },
  ])('renders recorded logs in $language with keyboard disclosure and reload', async (copy) => {
    const ownedPage = await browser.newPage({
      viewport: { width: 1680, height: 1000 }, locale: copy.locale, timezoneId: 'Asia/Shanghai',
    })
    page = ownedPage
    onTestFinished(() => ownedPage.close())
    onTestFailed(() => saveFailureShot(page, `web-e2e-crew-command-evidence-${copy.locale}`))
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.getByRole('treeitem').first().click()
    await page.getByRole('treeitem').nth(1).click()
    await page.getByRole('button', { name: copy.open }).click()
    await page.setViewportSize({ width: 1020, height: 800 })

    const panel = page.locator('[data-crew-details]')
    expect(await panel.getByText(copy.round).locator('..').locator('dd').textContent()).toBe('1')
    await panel.getByText(recordedCommitHash, { exact: true }).waitFor()
    const inputs = panel.locator('summary').filter({ hasText: copy.inputs })
    await inputs.press('Enter')
    expect(await panel.getByText('task-1', { exact: true }).count()).toBe(1)
    expect(await panel.getByText('task-2', { exact: true }).count()).toBe(1)
    const moduleCommand = panel.locator('summary').filter({ hasText: 'node --check index.mjs' })
    await moduleCommand.focus()
    await moduleCommand.press('Enter')
    await expect.poll(() => moduleCommand.locator('..').getAttribute('open')).toBe('')
    expect(await moduleCommand.locator('..').getByText(copy.empty, { exact: true }).count()).toBe(2)

    const integrationCommand = panel.locator('summary').filter({ hasText: 'node --test integration.test.mjs' })
    await integrationCommand.focus()
    await integrationCommand.press('Enter')
    const output = panel.getByRole('region', { name: copy.stdout })
    await output.waitFor()
    expect(await output.textContent()).toBe(recordedStdout)
    await output.focus()
    expect(await output.evaluate(element => element === document.activeElement)).toBe(true)
    const geometry = await output.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return { left: rect.left, right: rect.right, height: rect.height,
        maxHeight: Number.parseFloat(style.maxHeight), whiteSpace: style.whiteSpace, overflow: style.overflow }
    })
    expect(geometry.left).toBeGreaterThanOrEqual(0)
    expect(geometry.right).toBeLessThanOrEqual(1020)
    expect(geometry.height).toBeLessThanOrEqual(geometry.maxHeight)
    expect(geometry.whiteSpace).toBe('pre')
    expect(geometry.overflow).toBe('auto')
    expect(await panel.locator('input, textarea, [contenteditable]').count()).toBe(0)
    expect(await page.locator('[data-composer-input][contenteditable="true"]').count()).toBe(1)
    await compareOrRefreshGolden(join(EVIDENCE_DIR, copy.file),
      await captureStableAria(page, '[data-crew-details]', scaffold.workspaceCwd), MODE)
    await panel.screenshot({
      path: fileURLToPath(new URL(`../../../.run/crew-command-evidence-${copy.locale}.png`, import.meta.url)),
    })

    await integrationCommand.press('Enter')
    await output.waitFor({ state: 'hidden' })
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    if (await panel.count() === 0) await page.getByRole('button', { name: copy.open }).click()
    await integrationCommand.press('Enter')
    await output.waitFor()
    expect(await output.textContent()).toBe(recordedStdout)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })

  it('keeps the borrowed recording and browser fixture inventory closed', async () => {
    await assertFixtureInventory(EVIDENCE_DIR, ['evidence.expected.md', 'evidence.zh.expected.md'])
  })
})
