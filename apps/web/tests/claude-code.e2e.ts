// Real browser, native Claude CLI and local Messages transport; no paid inference.
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-crew'
import type {} from '@deepseek-ai/dsh-subagent-claude-code/engine'
import { startMessagesFixture } from '../../../packages/subagent/subagent-claude-code/tests/messages-fixture.ts'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

it('selects Claude for main and Crew Agents and continues the same native worker', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-claude-web-'))
  onTestFinished(() => rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  const server = await startMessagesFixture({ kind: 'complete', text: 'Claude fixture answer' })
  onTestFinished(() => server.close())
  const patch = join(temp, 'claude.patch.yml')
  const crewOverlay = await readFile(new URL('./crew-panel.overlay.yml', import.meta.url), 'utf8')
  await writeFile(patch, crewOverlay + '\n' + [
    '- id: claude-code-engine',
    '  config:',
    `    configDir: ${JSON.stringify(join(temp, 'claude'))}`,
    '    maxTurns: 4',
    '    env:',
    '      ANTHROPIC_API_KEY: dsh-local-fixture-key',
    `      ANTHROPIC_BASE_URL: ${JSON.stringify(server.baseUrl)}`,
    "      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'",
    "      CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1'",
    "      DISABLE_TELEMETRY: '1'",
    "      DISABLE_ERROR_REPORTING: '1'",
    "      HTTP_PROXY: ''",
    "      HTTPS_PROXY: ''",
    "      ALL_PROXY: ''",
    '      NO_PROXY: 127.0.0.1,localhost',
  ].join('\n') + '\n')
  const scaffold = await launchWebScaffold({ extraOverlayPath: patch,
    extraInstallAnchors: [fileURLToPath(new URL('../../../packages/bundle/crew-web-profile/package.json', import.meta.url))] })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  const tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Claude Code', exact: true }).click()
  await page.getByRole('button', { name: 'Refresh quota', exact: true }).waitFor()
  await expect.poll(() => dialog.getByRole('button', { name: 'Refresh account', exact: true }).isEnabled()).toBe(true)
  expect(server.requests).toHaveLength(0)
  await dialog.getByRole('button', { name: 'Agent orchestration', exact: true }).click()
  const selection = page.getByLabel('Developer · Model', { exact: true })
  await expect.poll(() => selection.isEnabled()).toBe(true)
  await selection.selectOption(JSON.stringify(['claude-code', 'claude-sonnet-5']))
  await expect.poll(() => scaffold.ctx.crewPreferences.snapshot().roles.developer).toEqual({ provider: 'claude-code', model: 'claude-sonnet-5' })
  const errors: unknown[] = []
  scaffold.ctx.on('agent/error', ({ error }) => { errors.push(error) })
  const handle = await scaffold.ctx.agents.create({ sessionId: SessionId('claude-main'), meta: { cwd: scaffold.workspaceCwd },
    agentOptions: { provider: 'claude-code', model: 'claude-sonnet-5' } })
  const manager = handle.agent
  const image = await scaffold.ctx.attachments.saveImage({ mediaType: 'image/png',
    data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') })
  const storedImage = await scaffold.ctx.attachments.readImage(image)
  manager.followup(createUserMessage({ content: [{ type: 'text', text: 'main fixture prompt' }, { type: 'image', attachment: image }], source: { kind: 'user' } }))
  await manager.whenIdle()
  expect(errors).toEqual([])
  expect(JSON.stringify(server.requests[0]?.body.messages)).toContain(Buffer.from(storedImage.data).toString('base64'))
  await writeFile(join(scaffold.workspaceCwd, 'spec.md'), 'Read the specification and report progress.')
  const work = await scaffold.ctx.crew.dispatch(manager, { moduleKey: 'sample', subject: 'Sample work', description: 'Review the specification.',
    specPath: 'spec.md', specRevision: 1, readScopes: ['spec.md', 'src'], writeScopes: ['src'], requiredArtifacts: [], testCommands: [], signal: new AbortController().signal })
  const child = scaffold.ctx.agents.get(work.developerSessionId!)!
  await child.whenIdle()
  const current = scaffold.ctx.crew.view(manager).workItems[0]!
  await scaffold.ctx.crew.append(manager, { taskId: current.taskId, expectedRevision: current.revision, message: 'Continue the same worker.', signal: new AbortController().signal })
  await child.whenIdle()
  expect(errors).toEqual([])
  expect(child.session.snapshotEvents().filter(event => event.type === 'claude-code/binding')).toHaveLength(1)
  expect(child.session.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(2)
  expect(manager.session.snapshotEvents().some(event => event.type === 'claude-code/binding')).toBe(true)
  expect(server.requests.every(request => request.body.model === 'claude-sonnet-5')).toBe(true)
  expect(existsSync(join(scaffold.workspaceCwd, '.git'))).toBe(false)
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
})
