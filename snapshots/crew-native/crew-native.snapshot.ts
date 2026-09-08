/** Keyless recorded-session proof for the shipped DSH-native Crew profile. */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { parseSessionLog, prepareSessionSnapshotFixtureForComparison } from '@deepseek-ai/dsh-llm-replay'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import {
  assertPersistedSessionVersion,
  assertSessionFixtureVersion,
  captureExpectedWorkspaceSnapshot,
  captureWorkspaceSnapshot,
  formatSystemPromptSnapshot,
  formatToolSchemasSnapshot,
  latestPersistedSessionPaths,
  normalizeSessionSnapshots,
  normalizedSystemPrompts,
  normalizedToolSchemas,
  parseSnapshotManifest,
  redactSessionSnapshotIds,
  refreshFixtureReplacements,
  scrubSessionSnapshot,
  sessionFixtureName,
  sessionFixtureNames,
  sessionHeaderVersion,
  stabilizeFixtureMessageIds,
  stabilizeRefreshLog,
  tokenizeSessionFixtureCwd,
  writesCurrentSessionFixtures,
  type HarvestedLog,
  type NormalizeContext,
} from '@deepseek-ai/dsh-session-snapshot'

type SnapshotMode = 'replay' | 'record' | 'refresh'

interface JsonObject {
  [key: string]: unknown
}

interface SessionLog {
  readonly content: string
  readonly header: JsonObject
}

const corpusRoot = fileURLToPath(new URL('./', import.meta.url))
const scenarioDir = join(corpusRoot, 'two-module')
const manifestPath = join(scenarioDir, 'snapshot.yml')
const manifest = parseSnapshotManifest(await readFile(manifestPath, 'utf8'), manifestPath)
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const dshBin = join(repoRoot, 'apps', 'cli', 'src', 'bin.ts')
const tsconfigPath = join(repoRoot, 'tsconfig.json')
const fixturePlugin = pathToFileURL(join(
  repoRoot,
  'apps',
  'cli',
  'tests',
  'profiles',
  'headless',
  'tests',
  'fixtures',
  'crew-llm.mjs',
)).href
const FIXED_GIT_DATE = '2000-01-01T00:00:00Z'
const RUNTIME_WORKSPACE_ENTRIES = ['.agents', '.dsh', '.git'] as const
const REPLAY_COMMAND_IDS = ['syntax-alpha', 'syntax-beta', 'combined'] as const

function snapshotMode(value: string | undefined): SnapshotMode {
  switch (value) {
    case undefined:
    case '':
    case 'replay': return 'replay'
    case 'record': return 'record'
    case 'refresh': return 'refresh'
    default: throw new Error(`unknown DSH_SNAPSHOT mode: ${value}`)
  }
}

const mode = snapshotMode(process.env.DSH_SNAPSHOT)

function records(content: string): JsonObject[] {
  return content.split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line) as JsonObject)
}

function headerOf(content: string): JsonObject {
  return records(content)[0] ?? {}
}

function messageText(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const message = value as JsonObject
  const source = message.source as JsonObject | undefined
  if (source?.kind !== 'user' || !Array.isArray(message.content)) return undefined
  const blocks = message.content as JsonObject[]
  return blocks.length === 1 && blocks[0]?.type === 'text' && typeof blocks[0].text === 'string'
    ? blocks[0].text
    : undefined
}

function taskFromSession(content: string): string {
  for (const record of records(content)) {
    if (record.type === 'user/message') {
      const task = messageText(record.data)
      if (task !== undefined) return task
    }
  }
  for (const record of records(content)) {
    if (record.type !== 'agent/inbox/spliced') continue
    const data = record.data as JsonObject | undefined
    if (!Array.isArray(data?.inserted)) continue
    for (const message of data.inserted) {
      const task = messageText(message)
      if (task !== undefined) return task
    }
  }
  throw new Error('crew-native parent fixture has no user task')
}

function modelFromSession(content: string): { provider: string; model: string } {
  for (const record of records(content)) {
    if (record.type !== 'request/header') continue
    const data = record.data as JsonObject | undefined
    const request = data?.header as JsonObject | undefined
    const config = request?.config as JsonObject | undefined
    if (typeof config?.provider === 'string' && typeof config.model === 'string') {
      return { provider: config.provider, model: config.model }
    }
  }
  throw new Error('crew-native parent fixture has no request model')
}

function finalTextFromSession(content: string): string {
  const messages = records(content).flatMap((record) => {
    if (record.type !== 'assistant/message') return []
    const data = record.data as JsonObject | undefined
    const message = data?.message as JsonObject | undefined
    return message === undefined ? [] : [message]
  })
  const contentBlocks = messages.at(-1)?.content
  if (!Array.isArray(contentBlocks)) return ''
  return (contentBlocks as JsonObject[])
    .flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])
    .join('')
}

function toolResultDiagnostics(content: string): string {
  const names = new Map<string, string>()
  const diagnostics: string[] = []
  for (const record of records(content)) {
    const data = record.data as JsonObject | undefined
    if (record.type === 'tool/call' && typeof data?.callId === 'string' && typeof data.name === 'string') {
      names.set(data.callId, data.name)
      continue
    }
    if (record.type !== 'tool/result') continue
    const message = data?.message as JsonObject | undefined
    if (!Array.isArray(message?.content)) continue
    for (const block of message.content as JsonObject[]) {
      if (block.type !== 'tool-result' || typeof block.toolCallId !== 'string' || !Array.isArray(block.content)) continue
      const text = (block.content as JsonObject[])
        .flatMap(item => item.type === 'text' && typeof item.text === 'string' ? [item.text] : [])
        .join('')
      diagnostics.push(`${names.get(block.toolCallId) ?? block.toolCallId}[error=${String(block.isError)}]: ${text.slice(0, 500)}`)
    }
  }
  return diagnostics.join(' | ')
}

function contextOf(logs: readonly string[]): NormalizeContext {
  const headers = logs.map(headerOf)
  return {
    sessionIds: headers.flatMap(header => typeof header.id === 'string' ? [header.id] : []),
    cwd: typeof headers[0]?.cwd === 'string' ? headers[0].cwd : '\0missing-cwd\0',
  }
}

function harvested(log: SessionLog): HarvestedLog {
  return {
    id: String(log.header.id),
    createdAt: Number(log.header.createdAt),
    ...(typeof log.header.parentSession === 'string' ? { parentSession: log.header.parentSession } : {}),
    content: log.content,
  }
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: FIXED_GIT_DATE,
      GIT_COMMITTER_DATE: FIXED_GIT_DATE,
    },
  })
}

async function seedRepository(cwd: string): Promise<void> {
  const source = join(scenarioDir, 'workspace')
  for (const entry of await readdir(source)) {
    await cp(join(source, entry), join(cwd, entry), { recursive: true, verbatimSymlinks: true })
  }
  git(cwd, ['init', '-b', 'main'])
  git(cwd, ['config', 'user.name', 'Crew Fixture'])
  git(cwd, ['config', 'user.email', 'crew@example.invalid'])
  git(cwd, ['config', 'core.autocrlf', 'false'])
  git(cwd, ['add', '--', 'modules', 'shared', 'tests'])
  git(cwd, ['commit', '-m', 'test: seed native Crew fixture'])
}

async function fixtureSessions(): Promise<{ files: string[]; logs: string[] }> {
  const files = sessionFixtureNames(await readdir(scenarioDir))
  const logs = await Promise.all(files.map(async (file) => {
    const content = await readFile(join(scenarioDir, file), 'utf8')
    assertSessionFixtureVersion(file, content)
    return content
  }))
  return { files, logs }
}

function replayFixtureContent(content: string): string {
  const replacements = new Map<string, string>()
  const visitStrings = (value: unknown, visit: (text: string) => void): void => {
    if (typeof value === 'string') {
      visit(value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visitStrings(item, visit)
      return
    }
    if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value)) visitStrings(item, visit)
    }
  }
  for (const record of records(content)) {
    if (record.type !== 'assistant/message' && record.type !== 'assistant/attempt') continue
    visitStrings(record, (text) => {
      for (const match of text.matchAll(/"verification_id":"(\{\{id:[1-9]\d*\}\})"/g)) {
        replacements.set(match[1] as string, '{{fromRequest:Review host verification ([^;\\s]+);}}')
      }
      for (const match of text.matchAll(/"integration_id":"(\{\{id:[1-9]\d*\}\})"/g)) {
        replacements.set(match[1] as string, '{{fromRequest:"integration_id":"([^"]+)"}}')
      }
    })
  }
  const replace = (value: unknown): unknown => {
    if (typeof value === 'string') {
      let output = value.replace(/\{\{command:([1-9]\d*)\}\}/g, (_token, ordinal: string) => {
        const commandId = REPLAY_COMMAND_IDS[Number(ordinal) - 1]
        if (commandId === undefined) throw new Error(`crew-native has no replay command for ordinal ${ordinal}`)
        return commandId
      })
      for (const [token, placeholder] of replacements) output = output.split(token).join(placeholder)
      return output
    }
    if (Array.isArray(value)) return value.map(replace)
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]))
    }
    return value
  }
  const output = records(content).map(record => JSON.stringify(replace(record))).join('\n')
  return content.endsWith('\n') ? `${output}\n` : output
}

function normalizeCrewValue(value: unknown, key?: string): unknown {
  if (key === 'startedAt' || key === 'finishedAt') return 0
  if (key === 'sourceEventSeqs') return [0]
  if (key === 'commitHash' || key === 'commit_hash') return '{{commit-hash}}'
  if (typeof value === 'string') {
    return value
      .replace(
        /\b((?:developer|reviewer|integrator)-[a-z0-9-]+-[1-9]\d*)-[0-9a-f]{8}\b/g,
        '$1-{{worker-suffix}}',
      )
      .replace(/("commit_hash"\s*:\s*")[0-9a-f]{40}(")/gi, '$1{{commit-hash}}$2')
      .replace(/\(\d+(?:\.\d+)?ms\)/g, '({{duration}}ms)')
      .replace(/(duration_ms )\d+(?:\.\d+)?/g, '$1{{duration}}')
  }
  if (Array.isArray(value)) return value.map(item => normalizeCrewValue(item))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([memberKey, member]) => [
      memberKey,
      normalizeCrewValue(member, memberKey),
    ]))
  }
  return value
}

function eventMember(record: JsonObject, key: string): JsonObject | undefined {
  const data = record.data
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined
  const member = (data as JsonObject)[key]
  return member !== null && typeof member === 'object' && !Array.isArray(member)
    ? member as JsonObject
    : undefined
}

function crewIdentityLabels(logs: readonly string[]): Map<string, string> {
  const all = logs.flatMap(records)
  const labels = new Map<string, string>()
  const assign = (id: unknown, label: string): void => {
    if (typeof id !== 'string') return
    const prior = labels.get(id)
    if (prior !== undefined && prior !== label) {
      throw new Error(`crew-native identity ${id} has conflicting labels ${prior} and ${label}`)
    }
    labels.set(id, label)
  }

  for (const record of all) {
    const report = record.type === 'crew/report' ? eventMember(record, 'report') : undefined
    if (report !== undefined) {
      const owner = typeof report.taskId === 'string' ? report.taskId : 'integration'
      const revision = typeof report.workItemRevision === 'number'
        ? report.workItemRevision
        : report.integrationRevision
      assign(report.id, `crew:report:${owner}:${String(report.role)}:${String(revision)}`)
    }
    const integration = record.type === 'crew/integration' ? eventMember(record, 'integration') : undefined
    if (integration !== undefined) {
      const inputs = Array.isArray(integration.inputs)
        ? integration.inputs.flatMap((input) => {
            if (input === null || typeof input !== 'object' || Array.isArray(input)) return []
            const taskId = (input as JsonObject).taskId
            return typeof taskId === 'string' ? [taskId] : []
          }).sort()
        : []
      assign(integration.id, `crew:integration:${inputs.join('+')}`)
    }
    const review = record.type === 'crew/review' ? eventMember(record, 'review') : undefined
    if (review !== undefined) assign(review.id, `crew:review:${String(review.taskId)}:${String(review.round)}`)
  }
  for (const record of all) {
    const verification = record.type === 'crew/verification' ? eventMember(record, 'verification') : undefined
    if (verification === undefined) continue
    const report = typeof verification.reportId === 'string' ? labels.get(verification.reportId) : undefined
    assign(verification.id, `crew:verification:${String(verification.taskId)}:${report ?? 'unknown-report'}`)
  }

  const notifications = new Map<string, { content: string; deliveryMessageId?: string }>()
  for (const record of all) {
    const notification = record.type === 'crew/notification' ? eventMember(record, 'notification') : undefined
    if (notification === undefined || typeof notification.id !== 'string') continue
    notifications.set(notification.id, {
      content: typeof notification.content === 'string' ? notification.content : '',
      ...(typeof notification.deliveryMessageId === 'string'
        ? { deliveryMessageId: notification.deliveryMessageId }
        : {}),
    })
  }
  const orderedNotifications = [...notifications.entries()]
    .sort((left, right) => left[1].content.localeCompare(right[1].content))
  for (const [index, [id, notification]] of orderedNotifications.entries()) {
    assign(id, `crew:notification:${index + 1}`)
    assign(notification.deliveryMessageId, `crew:notification-message:${index + 1}`)
  }
  for (const record of all) {
    const commit = record.type === 'crew/commit' ? eventMember(record, 'commit') : undefined
    if (commit !== undefined) assign(commit.id, `crew:commit:${String(commit.message)}`)
  }
  return labels
}

function replaceCrewIdentities(value: unknown, labels: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') {
    let output = value
    for (const [id, label] of labels) output = output.split(id).join(`{{${label}}}`)
    return output
  }
  if (Array.isArray(value)) return value.map(item => replaceCrewIdentities(item, labels))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, member]) => [
      key,
      replaceCrewIdentities(member, labels),
    ]))
  }
  return value
}

function normalizeCrewSnapshot(log: string, labels: ReadonlyMap<string, string>): string {
  const stable = records(log).map(record => normalizeCrewValue(
    replaceCrewIdentities(record, labels),
  ) as JsonObject)
  const foreground = stable.filter(record => (
    typeof record.type !== 'string'
    || !record.type.startsWith('crew/') && !record.type.startsWith('team/')
  ))
  const autonomous = stable.filter(record => (
    typeof record.type === 'string'
    && (record.type.startsWith('crew/') || record.type.startsWith('team/'))
  )).map(record => JSON.stringify(record)).sort()
  return [...foreground.map(record => JSON.stringify(record)), ...autonomous, ''].join('\n')
}

function normalizeCrewSnapshots(logs: readonly string[], context: NormalizeContext): string[] {
  const normalized = normalizeSessionSnapshots(logs, context)
  const labels = crewIdentityLabels(normalized)
  return normalized.map(log => normalizeCrewSnapshot(log, labels))
}

/** Derive valid live arguments without changing the committed identity-redacted Session fixtures. */
async function materializeReplayFixtures(
  root: string,
  fixtures: Readonly<{ files: readonly string[]; logs: readonly string[] }>,
): Promise<string[]> {
  await mkdir(root, { recursive: true })
  return await Promise.all(fixtures.files.map(async (file, index) => {
    const output = join(root, file)
    const content = replayFixtureContent(fixtures.logs[index] as string)
    parseSessionLog(content)
    await writeFile(output, content)
    return output
  }))
}

function orderedChildren(root: SessionLog, children: readonly SessionLog[]): SessionLog[] {
  const memberIds: string[] = []
  for (const record of records(root.content)) {
    if (record.type !== 'team/member') continue
    const data = record.data as JsonObject | undefined
    const member = data?.member as JsonObject | undefined
    if (typeof member?.id === 'string' && !memberIds.includes(member.id)) memberIds.push(member.id)
  }
  const byId = new Map(children.map(child => [String(child.header.id), child]))
  const ordered = memberIds.flatMap(id => byId.get(id) ?? [])
  if (ordered.length !== children.length) {
    throw new Error(`crew-native parent catalogues ${ordered.length} of ${children.length} persisted child Sessions`)
  }
  return ordered
}

async function persistedSessions(root: string): Promise<SessionLog[]> {
  const files = latestPersistedSessionPaths(await readdir(root, { recursive: true }))
  const logs = await Promise.all(files.map(async (file): Promise<SessionLog> => {
    const content = await readFile(join(root, file), 'utf8')
    assertPersistedSessionVersion(basename(file), content)
    return { content, header: headerOf(content) }
  }))
  const parents = logs.filter(log => typeof log.header.parentSession !== 'string')
  if (parents.length !== 1) throw new Error(`crew-native produced ${parents.length} parent Sessions`)
  const parent = parents[0] as SessionLog
  return [parent, ...orderedChildren(parent, logs.filter(log => log !== parent))]
}

async function writeSessionFixtures(
  actual: readonly SessionLog[],
  existing: readonly string[],
  context: NormalizeContext,
): Promise<string[]> {
  const names = actual.map((log, index) => sessionFixtureName(
    index,
    sessionHeaderVersion(log.content, `crew-native harvested Session ${index}`),
  ))
  const prior = names.map((_, index) => existing[index] ?? '')
  const replacements = mode === 'refresh'
    ? refreshFixtureReplacements(actual.map(harvested), prior)
    : []
  const fresh = actual.map((log, index) => {
    const stable = mode === 'refresh'
      ? stabilizeRefreshLog(log.content, prior[index] as string, replacements, context)
      : log.content
    return scrubSessionSnapshot(prepareSessionSnapshotFixtureForComparison(tokenizeSessionFixtureCwd(stable)))
  })
  const output = redactSessionSnapshotIds(stabilizeFixtureMessageIds(fresh, prior))
  await Promise.all(output.map((content, index) => writeFile(join(scenarioDir, names[index] as string), content)))
  return output
}

async function writeHeaderSidecars(actual: readonly SessionLog[], context: NormalizeContext): Promise<void> {
  await Promise.all(actual.flatMap((log, index) => {
    const suffix = index === 0 ? '' : `.${index}`
    const prompts = normalizedSystemPrompts(log.content, context)
    const schemas = normalizedToolSchemas(log.content, context)
    if (prompts.length === 0 || schemas.length === 0) {
      throw new Error(`crew-native Session ${index} has no request header to pin`)
    }
    return [
      writeFile(
        join(scenarioDir, `system-prompt${suffix}.expected.md`),
        formatSystemPromptSnapshot(prompts[0] as string, prompts.slice(1)),
      ),
      writeFile(
        join(scenarioDir, `tool-schemas${suffix}.expected.json`),
        formatToolSchemasSnapshot(schemas[0] as unknown[], schemas.slice(1)),
      ),
    ]
  }))
}

async function verifyHeaderSidecars(actual: readonly SessionLog[], context: NormalizeContext): Promise<void> {
  for (const [index, log] of actual.entries()) {
    const suffix = index === 0 ? '' : `.${index}`
    const prompts = normalizedSystemPrompts(log.content, context)
    const schemas = normalizedToolSchemas(log.content, context)
    expect(
      formatSystemPromptSnapshot(prompts[0] as string, prompts.slice(1)),
      `crew-native Session ${index} system prompt`,
    ).toBe(await readFile(join(scenarioDir, `system-prompt${suffix}.expected.md`), 'utf8'))
    expect(
      formatToolSchemasSnapshot(schemas[0] as unknown[], schemas.slice(1)),
      `crew-native Session ${index} tool schemas`,
    ).toBe(await readFile(join(scenarioDir, `tool-schemas${suffix}.expected.json`), 'utf8'))
  }
}

async function writeProfile(home: string, sessions: string, model: { provider: string; model: string }, files: readonly string[]): Promise<void> {
  const profileDir = join(home, 'profiles', 'crew-native')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-crew-native-snapshot',
    private: true,
    dependencies: {
      '@deepseek-ai/dsh-crew-profile': 'workspace:^',
      '@deepseek-ai/dsh-llm-replay': 'workspace:^',
    },
    dsh: {
      profile: {
        bundles: [
          '@deepseek-ai/dsh-base',
          '@deepseek-ai/dsh-headless',
          '@deepseek-ai/dsh-crew-profile',
        ],
      },
    },
  }, undefined, 2)}\n`)
  const replaying = mode !== 'record'
  await writeFile(join(profileDir, 'cordis.patch.yml'), [
    '- id: llm-deepseek',
    '  disabled: true',
    '- id: agent-default-model',
    '  config:',
    `    provider: ${model.provider}`,
    `    model: ${model.model}`,
    '- id: session-title-llm',
    '  disabled: true',
    '- id: session-persistence-jsonl',
    '  config:',
    `    root: ${JSON.stringify(sessions.replaceAll('\\', '/'))}`,
    '    compression: none',
    '- id: approval',
    '  config:',
    '    policy: ask',
    '- id: crew',
    '  inject: [crewProfilePresets]',
    '  config:',
    '    nativeProvider: spawn',
    '    maxConcurrentWorkers: 4',
    '    notificationBatchWindowMs: 20',
    '    workerTurnTimeoutMs: 900000',
    '    maxAutomaticRepairs: 1',
    '    maxReviewRounds: 2',
    '    allowedTestPrograms: [pnpm, npm, node]',
    '    commitPolicy:',
    '      maxMessageLength: 200',
    '      requireNamedBranch: true',
    '    roles: !!js ctx.crewProfilePresets.workerRoles',
    '- insert:',
    '    - id: crew-fixture-driver',
    `      name: ${JSON.stringify(fixturePlugin)}`,
    ...(replaying ? [
      '    - id: llm-replay',
      "      name: '@deepseek-ai/dsh-llm-replay'",
      '      config:',
      '        providers:',
      `          - id: ${model.provider}`,
      '            name: DeepSeek',
      '            models:',
      `              - id: ${model.model}`,
    ] : []),
    '',
  ].join('\n'))

  if (replaying && files.length < 2) throw new Error('crew-native replay requires committed child fixtures')
}

function verifyGitWorld(cwd: string): void {
  expect(git(cwd, ['rev-list', '--count', 'HEAD']).trim()).toBe('2')
  expect(git(cwd, ['show', '--pretty=format:', '--name-only', 'HEAD']).trim().split(/\r?\n/u).sort()).toEqual([
    'modules/alpha/index.mjs',
    'modules/beta/index.mjs',
  ])
  expect(git(cwd, ['remote']).trim()).toBe('')
  expect(git(cwd, ['status', '--short', '--untracked-files=all']).trim().split(/\r?\n/u).sort()).toEqual([
    '?? specs/alpha-v1.md',
    '?? specs/beta-v1.md',
  ])
}

describe('crew-native recorded-session snapshot', () => {
  it(`${mode}s the two-module workflow through dsh --profile crew-native`, async () => {
    if (manifest.profile !== 'crew-native' || manifest.workspace?.final !== true) {
      throw new Error('crew-native scenario manifest must own its profile and final workspace')
    }
    let fixtures = await fixtureSessions()
    const parentFixture = fixtures.logs[0]
    if (parentFixture === undefined) throw new Error('crew-native scenario has no parent fixture')
    const task = taskFromSession(parentFixture)
    const model = modelFromSession(parentFixture)
    const sandbox = await mkdtemp(join(tmpdir(), 'dsh-crew-native-snapshot-'))
    const repository = join(sandbox, 'repository')
    const home = join(sandbox, 'home')
    const sessions = join(home, 'sessions')
    let actual: SessionLog[] = []
    try {
      await Promise.all([mkdir(repository, { recursive: true }), mkdir(sessions, { recursive: true })])
      await seedRepository(repository)
      const initialWorkspace = await captureWorkspaceSnapshot(repository, {
        ignoredRootEntries: RUNTIME_WORKSPACE_ENTRIES,
      })
      await writeProfile(home, sessions, model, fixtures.files)
      const replayFixturePaths = mode === 'record'
        ? fixtures.files.map(file => join(scenarioDir, file))
        : await materializeReplayFixtures(join(home, 'replay-fixtures'), fixtures)
      const launch = resolveExampleLaunch({
        srcBin: dshBin,
        configArgs: ['--profile', 'crew-native', task],
        tsconfigPath,
        env: {
          DSH_HOME: home,
          DSH_AGENTS_HOME: join(sandbox, 'agents'),
          DSH_PERMISSION_MODE: 'workspace-write',
          DSH_SNAPSHOT: mode,
          DSH_SNAPSHOT_PROVIDER: model.provider,
          DSH_SNAPSHOT_MODEL: model.model,
          DSH_SNAPSHOT_FILE: replayFixturePaths[0] as string,
          ...(replayFixturePaths.length < 2 ? {} : {
            DSH_SNAPSHOT_CHILD_FILES: replayFixturePaths.slice(1).join(delimiter),
          }),
          DSH_TELEMETRY_DISABLED: '1',
          DEEPSEEK_API_KEY: '',
          GIT_AUTHOR_DATE: FIXED_GIT_DATE,
          GIT_COMMITTER_DATE: FIXED_GIT_DATE,
          NODE_OPTIONS: [
            process.env.NODE_OPTIONS,
            '--disable-warning=ExperimentalWarning',
            '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
          ].filter(Boolean).join(' '),
        },
      })
      const result = await execa(launch.command, launch.args, {
        cwd: repository,
        env: launch.env,
        input: '',
        timeout: 120_000,
        killSignal: 'SIGKILL',
        reject: false,
      })
      expect(
        result.exitCode,
        `dsh crew-native snapshot exited unexpectedly.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      ).toBe(0)
      expect(result.stderr).toBe('')
      actual = await persistedSessions(sessions)
      expect(
        actual,
        `crew-native persisted event tails: ${actual.map(log => records(log.content).slice(-20).map(record => record.type).join(', ')).join(' | ')}\n${actual.map(log => toolResultDiagnostics(log.content)).join('\n')}`,
      ).toHaveLength(7)

      const actualContext = contextOf(actual.map(log => log.content))
      if (writesCurrentSessionFixtures(manifest, mode)) {
        fixtures = {
          files: actual.map((log, index) => sessionFixtureName(
            index,
            sessionHeaderVersion(log.content, `crew-native harvested Session ${index}`),
          )),
          logs: await writeSessionFixtures(actual, fixtures.logs, actualContext),
        }
        await writeHeaderSidecars(actual, actualContext)
      }

      expect(result.stdout).toBe(finalTextFromSession(fixtures.logs[0] as string))
      const fixtureContext = contextOf(fixtures.logs)
      const actualSnapshots = normalizeCrewSnapshots(actual.map(log => log.content), actualContext)
      const expectedSnapshots = normalizeCrewSnapshots(fixtures.logs, fixtureContext)
      for (const [index, expectedSnapshot] of expectedSnapshots.entries()) {
        expect(actualSnapshots[index], `crew-native Session fixture ${index}`).toBe(expectedSnapshot)
      }
      await verifyHeaderSidecars(actual, actualContext)

      const finalWorkspace = await captureWorkspaceSnapshot(repository, {
        ignoredRootEntries: RUNTIME_WORKSPACE_ENTRIES,
      })
      expect(finalWorkspace).not.toEqual(initialWorkspace)
      expect(finalWorkspace).toEqual(await captureExpectedWorkspaceSnapshot(join(scenarioDir, 'workspace.expected')))
      verifyGitWorld(repository)
    } finally {
      await rm(sandbox, { recursive: true, force: true })
    }
  }, 150_000)

  it('owns exactly one current parent, six contiguous children, and their header sidecars', async () => {
    const expected = [
      'session.v2.jsonl',
      ...Array.from({ length: 6 }, (_, offset) => `session.${offset + 1}.v2.jsonl`),
      'snapshot.yml',
      'system-prompt.expected.md',
      'tool-schemas.expected.json',
      ...Array.from({ length: 6 }, (_, offset) => `system-prompt.${offset + 1}.expected.md`),
      ...Array.from({ length: 6 }, (_, offset) => `tool-schemas.${offset + 1}.expected.json`),
      'workspace',
      'workspace.expected',
    ].sort()
    const entries = (await readdir(scenarioDir)).sort()
    expect(entries).toEqual(expected)
    expect(existsSync(join(corpusRoot, 'crew-native.snapshot.ts'))).toBe(true)
    for (const file of sessionFixtureNames(entries)) {
      assertSessionFixtureVersion(file, await readFile(join(scenarioDir, file), 'utf8'))
    }
    expect(parseSessionLog((await fixtureSessions()).logs[0] as string).some(event => event.type === 'crew/commit')).toBe(true)
  })
})
