import { execFileSync } from 'node:child_process'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type AgentSetup, type ModelSelection } from '@deepseek-ai/dsh-agent'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { MessageId, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import {
  SessionId,
  SessionLogOffset,
} from '@deepseek-ai/dsh-session'
import type {
  SessionEvent,
  SessionHeader,
} from '@deepseek-ai/dsh-session'
import {
  SessionAlreadyExistsError,
  SessionPersistence,
  SessionPersistenceNotFoundError,
  SessionPersistenceRevision,
} from '@deepseek-ai/dsh-session-persistence'
import type {
  SessionAccess,
  SessionHandle,
  SessionPersistenceSnapshot,
} from '@deepseek-ai/dsh-session-persistence'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import SettingsFile from '@deepseek-ai/dsh-settings-file'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TeamService, { TeamId } from '../../agent-team/src/index.ts'
import CrewService, { CrewNotificationId, CrewPreferences, CrewMemoryId, CREW_PREFERENCES_NAMESPACE, type CrewNotificationSnapshot } from '../../crew/src/index.ts'
import type { CrewExecutionLimits } from '../../crew/src/execution.ts'
import { CrewHost } from '../../crew/src/host.ts'
import * as toolCrew from '../src/index.ts'

/** `CrewHost.runCommand` as a plain function type, for spy delegation. */
type HostRunCommand = (
  this: CrewHost,
  ...args: Parameters<CrewHost['runCommand']>
) => ReturnType<CrewHost['runCommand']>

const SIGNAL = new AbortController().signal
const WORKFLOW_TIMEOUT_MS = 30_000
const MANAGER_TOOLS = [
  'crew_append',
  'crew_commit',
  'crew_dispatch',
  'crew_edit_file',
  'crew_integrate',
  'crew_list_files',
  'crew_memory',
  'crew_read_file',
  'crew_reassign',
  'crew_status',
  'crew_stop',
  'crew_wait',
  'crew_write_file',
].sort()
const DEVELOPER_TOOLS = [
  'crew_edit_file',
  'crew_list_files',
  'crew_read_file',
  'crew_report',
  'crew_run_test',
  'crew_write_file',
].sort()
const contexts = new Set<Context>()
const roots: string[] = []
let callNumber = 0

interface MemoryRecord {
  readonly header: SessionHeader
  readonly inheritedEventCount: SessionLogOffset
  readonly events: SessionEvent[]
}

interface MemoryStore {
  readonly records: Map<SessionId, MemoryRecord>
}

/** Session query implementation whose search faces are outside Crew lifecycle tests. */
class TestSessionQuery extends SessionQueryEngine {
  override searchSessions(): Promise<never> {
    return Promise.reject(new Error('session search is not configured in this test'))
  }

  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('event search is not configured in this test'))
  }
}

class MemoryPersistence extends SessionPersistence {
  constructor(ctx: Context, private readonly config: MemoryStore) {
    super(ctx)
    ctx.on('session/event', (session, event) => {
      const record = this.config.records.get(session.id)
      if (record === undefined) throw new Error(`memory persistence has no record for "${session.id}"`)
      record.events.push(structuredClone(event))
    })
    ctx.on('session/flush', () => {})
  }

  override async create(
    header: SessionHeader,
    options: { inheritedEventCount?: SessionLogOffset } = {},
  ): Promise<SessionHandle> {
    if (this.config.records.has(header.id)) throw new SessionAlreadyExistsError(header.id)
    const record: MemoryRecord = {
      header: structuredClone(header),
      inheritedEventCount: options.inheritedEventCount ?? SessionLogOffset(0),
      events: [],
    }
    this.config.records.set(header.id, record)
    return this.handle(record, 'write')
  }

  override async open(id: SessionId, access: SessionAccess): Promise<SessionHandle> {
    const record = this.config.records.get(id)
    if (record === undefined) throw new SessionPersistenceNotFoundError(id)
    return this.handle(record, access)
  }

  override async flush(): Promise<void> {}

  override async stat(id: SessionId): Promise<SessionPersistenceSnapshot | undefined> {
    const record = this.config.records.get(id)
    return record === undefined ? undefined : this.snapshot(record)
  }

  override async list(): Promise<SessionPersistenceSnapshot[]> {
    return [...this.config.records.values()].map(record => this.snapshot(record))
  }

  private snapshot(record: MemoryRecord): SessionPersistenceSnapshot {
    return {
      header: structuredClone(record.header),
      revision: SessionPersistenceRevision(`tool-crew-${record.header.id}-${record.events.length}`),
      eventCount: record.events.length,
    }
  }

  private handle(record: MemoryRecord, access: SessionAccess): SessionHandle {
    let closed = false
    return {
      id: record.header.id,
      header: structuredClone(record.header),
      inheritedEventCount: record.inheritedEventCount,
      access,
      read: async (offset = 0, length = Number.MAX_SAFE_INTEGER) => ({
        eventState: 'detached', events: structuredClone(record.events.slice(offset, offset + length)),
      }),
      append: async (events) => {
        if (access !== 'write' || closed) throw new Error('memory persistence handle is not writable')
        record.events.push(...structuredClone(events))
      },
      flush: async () => {},
      close: async () => { closed = true },
      [Symbol.asyncDispose]: async () => { closed = true },
    }
  }
}

function fixtureRepository(localOnly = false): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tool-crew-'))
  roots.push(root)
  mkdirSync(join(root, 'specs'), { recursive: true })
  mkdirSync(join(root, 'project', 'src'), { recursive: true })
  writeFileSync(join(root, 'specs', 'module.md'), '# Module specification\n')
  writeFileSync(join(root, 'project', 'README.md'), '# Project\n')
  if (localOnly) return root
  execFileSync('git', ['init', '-b', 'main'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Crew Test'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'crew@example.invalid'], { cwd: root })
  execFileSync('git', ['add', '--', 'specs/module.md', 'project/README.md'], { cwd: root })
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root })
  return root
}

async function setup(
  repositoryRoot: string,
  script: ConstructorParameters<typeof MockAdapter>[0],
  options: {
    approval?: boolean
    managerId?: string
    maxAutomaticRepairs?: number
    maxReviewRounds?: number
    notificationBatchWindowMs?: number
    execution?: Partial<CrewExecutionLimits>
    resume?: boolean
    store?: MemoryStore
    dshHome?: string
    setupAgent?: AgentSetup
  } = {},
): Promise<{ ctx: Context; lead: Agent; adapter: MockAdapter; store: MemoryStore }> {
  const ctx = new Context()
  contexts.add(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const store = options.store ?? { records: new Map() }
  await ctx.plugin(MemoryPersistence, store)
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(TeamService)
  await ctx.plugin(LocalFileSystem, { cwd: repositoryRoot })
  await ctx.plugin(LocalSubprocessRuntime)
  if (options.dshHome !== undefined) {
    await ctx.plugin(SettingsFile, { dshHome: options.dshHome, watch: false })
    await ctx.plugin(CrewPreferences)
    await ctx.plugin(AgentDefaultModel, { provider: 'mock', model: 'mock' })
  }
  if (options.approval === true) await ctx.plugin(ApprovalService, { policy: 'ask' })
  await ctx.plugin(CrewService, {
    repositoryRoot,
    maxAutomaticRepairs: options.maxAutomaticRepairs ?? 1,
    ...(options.maxReviewRounds === undefined ? {} : { maxReviewRounds: options.maxReviewRounds }),
    notificationBatchWindowMs: options.notificationBatchWindowMs ?? 60_000,
    ...(options.execution === undefined ? {} : { execution: options.execution }),
  })
  await ctx.plugin(toolCrew)
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const managerId = SessionId(options.managerId ?? `tool-crew-lead-${contexts.size}`)
  const lead = options.resume === true
    ? (await ctx.agents.resume({ resumeSessionId: managerId, agentOptions: { provider: 'mock', model: 'mock' } })).agent
    : options.setupAgent === undefined
      ? await ctx.agentLoop.create(managerId, { provider: 'mock', model: 'mock' }, { cwd: repositoryRoot })
      : (await ctx.agents.create({ sessionId: managerId, agentOptions: { provider: 'mock', model: 'mock' }, meta: { cwd: repositoryRoot }, setup: options.setupAgent })).agent
  return { ctx, lead, adapter, store }
}

function execute(ctx: Context, agent: Agent, name: string, args: unknown) {
  return ctx.tools.execute({
    callId: ToolCallId(`crew-call-${++callNumber}`),
    name,
    arguments: args,
    agent,
    signal: SIGNAL,
  })
}

function resultText(result: Awaited<ReturnType<typeof execute>>): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

function cloneStore(store: MemoryStore): MemoryStore {
  return {
    records: new Map([...store.records].map(([id, record]) => [id, {
      header: structuredClone(record.header),
      inheritedEventCount: record.inheritedEventCount,
      events: structuredClone(record.events),
    }])),
  }
}

function appendCrashNotification(lead: Agent, suffix: string, messageObserved: boolean): CrewNotificationSnapshot {
  const source = lead.session.snapshotEvents().findLast(event => (
    event.type === 'crew/work-item' && event.data.workItem.stage === 'paused'
  ))
  if (source?.type !== 'crew/work-item') throw new Error('expected a paused Crew source event')
  const notification: CrewNotificationSnapshot = {
    id: CrewNotificationId(`crash-notification-${suffix}`),
    revision: 1,
    sourceEventSeqs: [source.seq],
    content: `Recovered Crew notification ${suffix}.`,
    status: 'queued',
    deliveryMessageId: MessageId(`crash-message-${suffix}`),
  }
  lead.session.append('crew/notification', {
    version: 1,
    teamId: TeamId(lead.id),
    notification,
  })
  if (messageObserved) {
    lead.session.append('user/message', {
      id: notification.deliveryMessageId,
      role: 'user',
      content: [{ type: 'text', text: notification.content }],
      source: { kind: 'crew-notification', notificationId: notification.id },
    }, { surfaceOp: 'append' })
  }
  return notification
}

async function assembly(ctx: Context, agent: Agent) {
  const scope = scopeOf(agent.ctx)
  if (scope === undefined) throw new Error('expected exact Agent scope')
  return await ctx.systemPrompt.assemble({ scope })
}

afterEach(async () => {
  const failures: unknown[] = []
  for (const ctx of [...contexts].reverse()) {
    try {
      await ctx.fiber.dispose()
    } catch (error: unknown) {
      failures.push(error)
    } finally {
      contexts.delete(ctx)
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  if (failures.length > 0) throw new AggregateError(failures, 'tool-crew test cleanup failed')
}, WORKFLOW_TIMEOUT_MS)

describe('dsh-tool-crew', () => {
  it('uses the resumed Crew configuration for host process limits after deployment defaults change', async () => {
    const repositoryRoot = fixtureRepository()
    const first = await setup(repositoryRoot, [], { managerId: 'crew-process-limits', execution: { maxOutputBytes: 1024 } })
    await first.ctx.crew.ensureConfigured(first.lead)
    await first.ctx.sessions.flush(first.lead.session)
    await first.ctx.fiber.dispose()
    contexts.delete(first.ctx)

    const second = await setup(repositoryRoot, [], {
      managerId: 'crew-process-limits', resume: true, store: first.store, execution: { maxOutputBytes: 4096 },
    })
    writeFileSync(join(repositoryRoot, 'project', 'staged.txt'), 'host-owned pending change')
    execFileSync('git', ['add', '--', 'project/staged.txt'], { cwd: repositoryRoot })
    const spawned = vi.spyOn(second.ctx.subprocess, 'spawn')
    onTestFinished(() => { spawned.mockRestore() })
    await expect(second.ctx.crew.dispatch(second.lead, {
      moduleKey: 'module', subject: 'Module', description: 'Inspect the checkout before admission.',
      specPath: 'specs/module.md', specRevision: 1, readScopes: ['specs'], writeScopes: ['project/src'],
      requiredArtifacts: [], testCommands: [], signal: SIGNAL,
    })).rejects.toThrow('requires an unstaged checkout')
    expect(spawned).toHaveBeenCalled()
    for (const [spec] of spawned.mock.calls) {
      expect(spec.stdio.stdout).toEqual({ maxBytes: 1024 })
      expect(spec.stdio.stderr).toEqual({ maxBytes: 1024 })
    }
  })

  it('runs manager-declared tests in the project and retains their output files', async () => {
    const repositoryRoot = fixtureRepository()
    writeFileSync(join(repositoryRoot, '.git', 'info', 'exclude'), '.env\n')
    writeFileSync(join(repositoryRoot, '.env'), 'CREW_TEST_CANARY=fixture-only\n')
    const { ctx, lead } = await setup(repositoryRoot, ['hang'])
    const work = await ctx.crew.dispatch(lead, {
      moduleKey: 'module',
      subject: 'Implement module',
      description: 'Run the declared module test in the actual project.',
      specPath: 'specs/module.md',
      specRevision: 1,
      readScopes: ['specs', 'project/src'],
      writeScopes: ['project/src'],
      requiredArtifacts: ['project/src/probe.mjs'],
      testCommands: [{ id: 'probe', argv: ['node', 'src/probe.mjs'], cwd: 'project', timeoutMs: 10_000 }],
      signal: SIGNAL,
    })
    const child = await vi.waitFor(() => {
      const agent = ctx.agents.get(work.developerSessionId!)
      expect(agent).toBeDefined()
      return agent!
    })
    const written = await execute(ctx, child, 'crew_write_file', {
      path: 'project/src/probe.mjs',
      content: [
        "import { readFileSync, writeFileSync } from 'node:fs'",
        "writeFileSync('src/allowed-output.txt', 'scoped write\\n')",
        "console.log(JSON.stringify({ output: readFileSync('src/allowed-output.txt', 'utf8') }))",
      ].join('\n'),
    })
    expect(written.isError).toBe(false)
    const result = await execute(ctx, child, 'crew_run_test', { command_id: 'probe' })
    expect(result.isError).toBe(false)
    const testRun = JSON.parse(resultText(result)) as { stdout: string; exit_code: number }
    expect(testRun.exit_code).toBe(0)
    expect(readFileSync(join(repositoryRoot, 'project', 'src', 'allowed-output.txt'), 'utf8')).toBe('scoped write\n')
    expect.soft(readFileSync(join(repositoryRoot, 'project', 'README.md'), 'utf8')).toBe('# Project\n')
    expect(JSON.parse(testRun.stdout)).toEqual({ output: 'scoped write\n' })
  })

  it('installs disjoint manager and developer surfaces before the first worker request', async () => {
    const repositoryRoot = fixtureRepository()
    const { ctx, lead } = await setup(repositoryRoot, ['hang'])
    const leadAssembly = await assembly(ctx, lead)
    expect(leadAssembly.tools.map(tool => tool.name).filter(name => name.startsWith('crew_')).sort())
      .toEqual(MANAGER_TOOLS)
    expect(renderPrompt(leadAssembly)).toContain('manager of a DSH-native software Crew')

    const noWorkerWait = await execute(ctx, lead, 'crew_wait', { timeout_ms: 10_000 })
    expect(JSON.parse(resultText(noWorkerWait))).toMatchObject({
      timedOut: false,
      noProgress: { reason: 'no-active-worker' },
    })

    const managerWrite = await execute(ctx, lead, 'crew_write_file', {
      path: 'specs/manager.md', content: '# Manager-owned specification\n',
    })
    expect(managerWrite.isError).toBe(false)
    const gitWrite = await execute(ctx, lead, 'crew_write_file', {
      path: '.git/config', content: 'not allowed\n',
    })
    expect(gitWrite.isError).toBe(true)
    const credentialRead = await execute(ctx, lead, 'crew_read_file', { path: '.env' })
    expect(credentialRead.isError).toBe(true)

    const work = await ctx.crew.dispatch(lead, {
      moduleKey: 'module',
      subject: 'Implement module',
      description: 'Create the declared JavaScript artifact.',
      specPath: 'specs/module.md',
      specRevision: 1,
      readScopes: ['specs', 'project'],
      writeScopes: ['project/src'],
      requiredArtifacts: ['project/src/index.js'],
      testCommands: [{ id: 'syntax', argv: ['node', '--check', 'src/index.js'], cwd: 'project', timeoutMs: 10_000 }],
      signal: SIGNAL,
    })
    const child = await vi.waitFor(() => {
      const current = ctx.agents.get(work.developerSessionId!)
      expect(current).toBeDefined()
      return current!
    })
    const childAssembly = await assembly(ctx, child)
    expect(childAssembly.tools.map(tool => tool.name).filter(name => name.startsWith('crew_')).sort())
      .toEqual(DEVELOPER_TOOLS)
    expect(childAssembly.tools.map(tool => tool.name)).not.toContain('bash')
    expect(renderPrompt(childAssembly)).toContain('Do not use Git, raw shell commands, external CLIs')

    const adjacent = await execute(ctx, child, 'crew_write_file', {
      path: 'project/README.md', content: 'not allowed\n',
    })
    expect(adjacent.isError).toBe(true)
    const parentEscape = await execute(ctx, child, 'crew_write_file', {
      path: '../escape.js', content: 'not allowed\n',
    })
    expect(parentEscape.isError).toBe(true)
    symlinkSync(join(repositoryRoot, 'project'), join(repositoryRoot, 'project', 'src', 'linked'), 'junction')
    const linkEscape = await execute(ctx, child, 'crew_write_file', {
      path: 'project/src/linked/escape.js', content: 'not allowed\n',
    })
    expect(linkEscape.isError).toBe(true)
    const arbitraryTest = await execute(ctx, child, 'crew_run_test', { command_id: 'not-declared' })
    expect(arbitraryTest.isError).toBe(true)

    const stopped = await ctx.crew.stop(lead, {
      taskId: work.taskId,
      expectedRevision: work.revision,
      reason: 'test cleanup',
    })
    expect(stopped.stage).toBe('paused')
  })

  it.each([
    ['crew_read_file', {}],
    ['crew_write_file', { content: 'replacement\n' }],
    ['crew_edit_file', { old_string: 'fixture-only', new_string: 'replacement' }],
  ] as const)('rejects regular-file aliases to credentials in %s', async (name, args) => {
    const repositoryRoot = fixtureRepository()
    const credential = join(repositoryRoot, '.env')
    const alias = 'project/src/alias.txt'
    const canary = 'CREW_LINK_CANARY=fixture-only\n'
    writeFileSync(credential, canary)
    linkSync(credential, join(repositoryRoot, alias))
    const { ctx, lead } = await setup(repositoryRoot, [])
    const result = await execute(ctx, lead, name, { path: alias, ...args })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('hard-link count')
    expect(resultText(result)).not.toContain('CREW_LINK_CANARY')
    expect(readFileSync(credential, 'utf8')).toBe(canary)
    expect(readFileSync(join(repositoryRoot, alias), 'utf8')).toBe(canary)
  })

  it('rejects file access when the provider cannot establish a single hard link', async () => {
    const repositoryRoot = fixtureRepository()
    const { ctx, lead } = await setup(repositoryRoot, [])
    const original = ctx.fs.lstat.bind(ctx.fs)
    const metadata = vi.spyOn(ctx.fs, 'lstat').mockImplementation(async (...args) => {
      const info = await original(...args)
      if (info === undefined) return undefined
      const result = { ...info }
      delete result.linkCount
      return result
    })
    onTestFinished(() => { metadata.mockRestore() })
    const result = await execute(ctx, lead, 'crew_read_file', { path: 'project/README.md' })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('hard-link count')
  })

  it('rejects missing or divergent required role presets at plugin load', async () => {
    const missing = new Context()
    expect(() => { toolCrew.apply(missing, { requireRolePresets: true }) }).toThrow(
      'required manager role preset is missing',
    )
    await missing.fiber.dispose()

    const divergent = new Context()
    expect(() => {
      toolCrew.apply(divergent, { roleTools: { manager: ['crew_status'] } })
    }).toThrow('manager role preset must declare exactly')
    await divergent.fiber.dispose()
  })

  it('keeps one manager-action wait pending across worker edges until intervention is needed', async () => {
    const repositoryRoot = fixtureRepository()
    const { ctx, lead } = await setup(repositoryRoot, ['hang'])
    const work = await ctx.crew.dispatch(lead, {
      moduleKey: 'module', subject: 'Implement module', description: 'Hold until stopped.',
      specPath: 'specs/module.md', specRevision: 1, readScopes: ['specs', 'project/src'],
      writeScopes: ['project/src'], requiredArtifacts: [], testCommands: [], signal: SIGNAL,
    })
    const onSpy = vi.spyOn(ctx, 'on')
    const waiting = execute(ctx, lead, 'crew_wait', { timeout_ms: 10_000, until: 'manager-action' })
    await vi.waitFor(() => {
      expect(onSpy.mock.calls.some(call => call[0] === 'session/event')).toBe(true)
    })

    const current = ctx.crew.view(lead).workItems.find(item => item.taskId === work.taskId)!
    await ctx.crew.stop(lead, {
      taskId: current.taskId,
      expectedRevision: current.revision,
      reason: 'Manager intervention test.',
    })

    const result = await waiting
    expect(result.isError).toBe(false)
    expect(JSON.parse(resultText(result))).toEqual({ timedOut: false })
  })

  it('continues the same developer Session and supports two disjoint concurrent workers', async () => {
    const repositoryRoot = fixtureRepository()
    const { ctx, lead } = await setup(repositoryRoot, ['hang', 'hang'])
    const first = await ctx.crew.dispatch(lead, {
      moduleKey: 'module-a', subject: 'Module A', description: 'Hold Module A.',
      specPath: 'specs/module.md', specRevision: 1, readScopes: ['specs', 'project/src/a'],
      writeScopes: ['project/src/a'], requiredArtifacts: [], testCommands: [], signal: SIGNAL,
    })
    const originalDeveloper = first.developerSessionId!
    await ctx.crew.append(lead, {
      taskId: first.taskId,
      expectedRevision: first.revision,
      message: 'Continue the same assignment with the clarified requirement.',
      signal: SIGNAL,
    })
    const continued = ctx.crew.view(lead).workItems.find(item => item.taskId === first.taskId)!
    expect(continued.developerSessionId).toBe(originalDeveloper)
    expect(ctx.agentTeams.listMembers(lead).filter(member => member.id === originalDeveloper)).toHaveLength(1)
    expect(ctx.agents.get(originalDeveloper)?.inbox.nextStep.some(message => (
      message.content.some(block => block.type === 'text' && block.text.includes('clarified requirement'))
    ))).toBe(true)

    const second = await ctx.crew.dispatch(lead, {
      moduleKey: 'module-b', subject: 'Module B', description: 'Hold Module B.',
      specPath: 'specs/module.md', specRevision: 1, readScopes: ['specs', 'project/src/b'],
      writeScopes: ['project/src/b'], requiredArtifacts: [], testCommands: [], signal: SIGNAL,
    })
    expect(second.developerSessionId).not.toBe(originalDeveloper)
    expect(ctx.crew.view(lead).workItems.map(item => item.stage)).toEqual(['running', 'running'])

    const latestFirst = ctx.crew.view(lead).workItems.find(item => item.taskId === first.taskId)!
    await ctx.crew.stop(lead, { taskId: latestFirst.taskId, expectedRevision: latestFirst.revision, reason: 'test cleanup' })
    const latestSecond = ctx.crew.view(lead).workItems.find(item => item.taskId === second.taskId)!
    await ctx.crew.stop(lead, { taskId: latestSecond.taskId, expectedRevision: latestSecond.revision, reason: 'test cleanup' })
  })

  it('reassigns parked work to a fresh durable developer without deleting the original Session', async () => {
    const repositoryRoot = fixtureRepository()
    const { ctx, lead } = await setup(repositoryRoot, ['hang', 'hang'])
    const first = await ctx.crew.dispatch(lead, {
      moduleKey: 'module', subject: 'Module', description: 'Hold the first assignment.',
      specPath: 'specs/module.md', specRevision: 1, readScopes: ['specs', 'project/src'],
      writeScopes: ['project/src'], requiredArtifacts: [], testCommands: [], signal: SIGNAL,
    })
    const firstDeveloper = first.developerSessionId!
    const paused = await ctx.crew.stop(lead, {
      taskId: first.taskId, expectedRevision: first.revision, reason: 'Replace this worker.',
    })

    const reassigned = await ctx.crew.reassign(lead, {
      taskId: paused.taskId,
      expectedRevision: paused.revision,
      reason: 'Start a fresh developer while preserving the parked evidence.',
      signal: SIGNAL,
    })

    expect(reassigned.stage).toBe('running')
    expect(reassigned.developerSessionId).not.toBe(firstDeveloper)
    expect(reassigned.workerSessionIds).toEqual([firstDeveloper, reassigned.developerSessionId])
    expect(ctx.agentTeams.listMembers(lead).map(member => member.id)).toEqual(expect.arrayContaining([
      firstDeveloper,
      reassigned.developerSessionId,
    ]))
    const stopped = await ctx.crew.stop(lead, {
      taskId: reassigned.taskId, expectedRevision: reassigned.revision, reason: 'test cleanup',
    })
    expect(stopped.stage).toBe('paused')
  })

  it('recovers one active native developer from its durable descriptor without duplicating work', async () => {
    const repositoryRoot = fixtureRepository()
    const store: MemoryStore = { records: new Map() }
    const first = await setup(repositoryRoot, ['hang'], {
      managerId: 'crew-active-recovery',
      store,
    })
    const work = await first.ctx.crew.dispatch(first.lead, {
      moduleKey: 'module', subject: 'Module', description: 'Remain active across a simulated crash.',
      specPath: 'specs/module.md', specRevision: 1, readScopes: ['specs', 'project/src'],
      writeScopes: ['project/src'], requiredArtifacts: [], testCommands: [], signal: SIGNAL,
    })
    const developerId = work.developerSessionId!
    const crashStore = cloneStore(store)
    await first.ctx.fiber.dispose()
    contexts.delete(first.ctx)

    const second = await setup(repositoryRoot, ['hang'], {
      managerId: 'crew-active-recovery',
      resume: true,
      store: crashStore,
    })
    await vi.waitFor(() => {
      expect(second.ctx.agents.get(developerId)?.status).toBe('running')
    }, { timeout: 10_000 })
    expect(second.ctx.crew.view(second.lead).workItems).toEqual([
      expect.objectContaining({ taskId: work.taskId, developerSessionId: developerId, stage: 'running' }),
    ])
    expect(second.ctx.agentTeams.listTasks(second.lead)).toHaveLength(1)
    expect(second.ctx.agentTeams.listMembers(second.lead).filter(member => member.id === developerId)).toHaveLength(1)
    const latest = second.ctx.crew.view(second.lead).workItems[0]!
    await second.ctx.crew.stop(second.lead, {
      taskId: latest.taskId, expectedRevision: latest.revision, reason: 'test cleanup',
    })
  }, 20_000)

  it('keeps commit behind approval even when no approval service is composed', async () => {
    const repositoryRoot = fixtureRepository()
    const { ctx, lead } = await setup(repositoryRoot, [])
    const result = await execute(ctx, lead, 'crew_commit', {
      integration_id: 'missing-integration',
      message: 'must not execute',
    })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('local Git commit containing only the paths approved')
    expect(lead.session.snapshotEvents().some(event => event.type === 'crew/commit')).toBe(false)
  })

  it('logs current global memory on manager turns and does not convert preferences into authorization', async () => {
    const repositoryRoot = fixtureRepository()
    const dshHome = mkdtempSync(join(tmpdir(), 'dsh-crew-memory-tools-'))
    roots.push(dshHome)
    const { ctx, lead, adapter } = await setup(repositoryRoot, [textResponse('First turn.'), textResponse('Second turn.')], { dshHome })
    const saved = await execute(ctx, lead, 'crew_memory', {
      operation: 'save', entry_id: 'test-habit', expected_revision: 0,
      kind: 'preference', text: 'Usually approve unit tests.', scope: 'Project unit tests.',
    })
    expect(saved.isError).toBe(false)
    const revision = ctx.crewPreferences.snapshot().revision
    const denied = await execute(ctx, lead, 'crew_memory', {
      operation: 'save', entry_id: 'automatic-deletion', expected_revision: revision,
      kind: 'authorization', text: 'Automatically delete files.', scope: 'All projects.',
    })
    expect(denied.isError).toBe(true)
    expect(ctx.crewPreferences.snapshot().memory[CrewMemoryId('automatic-deletion')]).toBeUndefined()
    lead.followup(createUserMessage({ content: [{ type: 'text', text: 'Inspect the project.' }], source: { kind: 'user' } }))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1); expect(lead.status).toBe('idle') })
    const memoryEvents = () => lead.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'crew-memory')
    expect(JSON.stringify(memoryEvents())).toContain('Usually approve unit tests.')
    await ctx.crewPreferences.deleteMemory(CrewMemoryId('test-habit'), ctx.crewPreferences.snapshot().revision)
    lead.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue.' }], source: { kind: 'user' } }))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2); expect(lead.status).toBe('idle') })
    expect(memoryEvents()).toHaveLength(2)
    expect(JSON.stringify(memoryEvents().at(-1))).not.toContain('Usually approve unit tests.')
    expect(JSON.stringify(memoryEvents().at(-1))).toContain('replaces earlier memory snapshots')
  })

  it('uses the manager default through entry-point selection while explicit conversation choices win', async () => {
    const repositoryRoot = fixtureRepository()
    const dshHome = mkdtempSync(join(tmpdir(), 'dsh-crew-manager-model-'))
    roots.push(dshHome)
    const selection: { picked?: ModelSelection } = {}
    const { ctx, lead, adapter } = await setup(repositoryRoot, [textResponse('Default.'), textResponse('Selected.')], {
      dshHome,
      setupAgent: async (scoped) => {
        await scoped.inject(['agentDefaultModel'], (modelCtx) => {
          modelCtx.effect(() => installModelSelection(scoped, {
            get current() { return selection.picked ?? modelCtx.agentDefaultModel.currentSelection(scoped.agent) },
            assembled: undefined,
          }), 'test.entryPointModelSelection()')
        })
      },
    })
    await ctx.settings.mutate(CREW_PREFERENCES_NAMESPACE, [{ op: 'set', path: ['roles', 'manager'], value: { provider: 'mock', model: 'manager-model' } }])
    expect(ctx.agentDefaultModel.currentSelection(lead).model).toBe('manager-model')
    expect(ctx.agentDefaultModel.currentSelection().model).toBe('mock')
    lead.followup(createUserMessage({ content: [{ type: 'text', text: 'Begin.' }], source: { kind: 'user' } }))
    await vi.waitFor(() => { expect(adapter.requests, JSON.stringify(lead.session.snapshotEvents())).toHaveLength(1); expect(lead.status).toBe('idle') })
    expect(adapter.requests[0]?.model).toBe('manager-model')
    selection.picked = { provider: 'mock', model: 'conversation-model' }
    lead.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue.' }], source: { kind: 'user' } }))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2); expect(lead.status).toBe('idle') })
    expect(adapter.requests[1]?.model).toBe('conversation-model')
    expect(lead.session.requestHeader()?.config.model).toBe('conversation-model')
  })

  it('keeps a running developer model binding while new developers use updated role defaults', async () => {
    const repositoryRoot = fixtureRepository()
    const dshHome = mkdtempSync(join(tmpdir(), 'dsh-crew-role-models-'))
    roots.push(dshHome)
    const { ctx, lead } = await setup(repositoryRoot, ['hang', 'hang'], { dshHome })
    await ctx.settings.mutate(CREW_PREFERENCES_NAMESPACE, [{ op: 'set', path: ['roles', 'developer'], value: { provider: 'mock', model: 'developer-first' } }])
    const request = {
      moduleKey: 'first', subject: 'First', description: 'Hold one developer.', specPath: 'specs/module.md', specRevision: 1,
      readScopes: ['specs'], writeScopes: ['project/first'], requiredArtifacts: [], testCommands: [], signal: SIGNAL,
    }
    const first = await ctx.crew.dispatch(lead, request)
    const firstAgent = await vi.waitFor(() => {
      const child = ctx.agents.get(first.developerSessionId!)
      expect(child?.status).toBe('running')
      return child!
    })
    expect(firstAgent.options.model).toBe('developer-first')
    await ctx.settings.mutate(CREW_PREFERENCES_NAMESPACE, [{ op: 'set', path: ['roles', 'developer'], value: { provider: 'mock', model: 'developer-next' } }])
    const second = await ctx.crew.dispatch(lead, { ...request, moduleKey: 'second', writeScopes: ['project/second'] })
    const secondAgent = await vi.waitFor(() => {
      const child = ctx.agents.get(second.developerSessionId!)
      expect(child?.status).toBe('running')
      return child!
    })
    expect(secondAgent.options.model).toBe('developer-next')
    expect(firstAgent.options.model).toBe('developer-first')
  }, WORKFLOW_TIMEOUT_MS)

  it('gives developers shared directories, reviewers complete reads, and integrators actual edit and test tools', async () => {
    const repositoryRoot = fixtureRepository()
    const runtime = {} as { ctx: Context; lead: Agent }
    const script: ConstructorParameters<typeof MockAdapter>[0] = [
      toolCallResponse('shared-doc', 'crew_write_file', { path: 'docs/architecture.md', content: 'Module notes.' }),
      toolCallResponse('module-write', 'crew_write_file', { path: 'project/src/index.js', content: 'export const value = 42\n' }),
      toolCallResponse('module-report', 'crew_report', { verdict: 'ready', summary: 'Module and shared notes ready.', changed_paths: ['docs/architecture.md', 'project/src/index.js'], issues: [] }),
      textResponse('Development complete.'),
      toolCallResponse('review-project', 'crew_read_file', { path: 'project/README.md' }),
      toolCallResponse('review-denied-write', 'crew_write_file', { path: 'project/README.md', content: 'reviewer edit' }),
      () => toolCallResponse('review-report', 'crew_report', {
        verdict: 'passed', summary: 'Project requirements checked.', changed_paths: [], issues: [],
        verification_id: runtime.ctx.crew.view(runtime.lead).workItems[0]?.latestVerificationId,
      }),
      textResponse('Review complete.'),
      toolCallResponse('integration-write', 'crew_write_file', { path: 'project/glue.mjs', content: "export { value } from './src/index.js'\n" }),
      toolCallResponse('integration-test', 'crew_run_test', { command_id: 'combined' }),
      toolCallResponse('integration-report', 'crew_report', { verdict: 'passed', summary: 'Connected the public entry.', changed_paths: ['project/glue.mjs'], issues: [] }),
      textResponse('Integration complete.'),
    ]
    const { ctx, lead, store } = Object.assign(runtime, await setup(repositoryRoot, script))
    await ctx.crew.dispatch(lead, {
      moduleKey: 'module', subject: 'Module', description: 'Implement one module with shared notes.',
      specPath: 'specs/module.md', specRevision: 1, readScopes: ['specs'], writeScopes: ['project/src'],
      requiredArtifacts: ['project/src/index.js'], testCommands: [], signal: SIGNAL,
    })
    await vi.waitFor(() => { expect(ctx.crew.view(lead).workItems[0]?.stage).toBe('integration_ready') }, { timeout: 15_000 })
    const reviewer = store.records.get(ctx.crew.view(lead).workItems[0]!.reviewerSessionId!)!
    expect(reviewer.events.some(event => event.type === 'tool/result' && JSON.stringify(event.data).includes('# Project'))).toBe(true)
    expect(reviewer.events.some(event => event.type === 'tool/result'
      && event.data.message.content[0].toolCallId === 'review-denied-write'
      && event.data.message.content[0].isError)).toBe(true)
    expect(readFileSync(join(repositoryRoot, 'project/README.md'), 'utf8')).toBe('# Project\n')
    const integration = await ctx.crew.integrate(lead, {
      testCommands: [{ id: 'combined', argv: ['node', '--check', 'glue.mjs'], cwd: 'project', timeoutMs: 10_000 }], signal: SIGNAL,
    })
    await vi.waitFor(() => { expect(ctx.crew.view(lead).integrations.find(item => item.id === integration.id)?.status).toBe('passed') }, { timeout: 15_000 })
    expect(readFileSync(join(repositoryRoot, 'project/glue.mjs'), 'utf8')).toContain('export { value }')
    expect(ctx.crew.view(lead).integrations[0]?.approvedPaths).toEqual(['docs/architecture.md', 'project/glue.mjs', 'project/src/index.js'])
    expect(ctx.crew.view(lead).integrations[0]?.commands[0]?.exitCode).toBe(0)
  }, WORKFLOW_TIMEOUT_MS)

  // Multiple native turns and serial Git-backed approvals share this one test deadline.
  it.each([false, true])('runs developer, verification, reviewer, and integration (localOnly=%s)', async (localOnly) => {
    const repositoryRoot = fixtureRepository(localOnly)
    const runtime = {} as { ctx: Context; lead: Agent }
    const script: ConstructorParameters<typeof MockAdapter>[0] = [
      toolCallResponse('write-artifact', 'crew_write_file', {
        path: 'project/src/index.js',
        content: 'export const answer = 42\n',
      }),
      toolCallResponse('developer-report', 'crew_report', {
        verdict: 'ready',
        summary: 'Implemented the module and declared its changed path.',
        changed_paths: ['project/src/index.js'],
        issues: [],
      }),
      textResponse('Developer handoff complete.'),
      () => {
        const verificationId = runtime.ctx.crew.view(runtime.lead).workItems[0]?.latestVerificationId
        if (verificationId === undefined) throw new Error('reviewer request started without verification evidence')
        return toolCallResponse('reviewer-report', 'crew_report', {
          verdict: 'passed',
          summary: 'The implementation matches the frozen specification.',
          changed_paths: [],
          issues: [],
          verification_id: verificationId,
        })
      },
      textResponse('Review complete.'),
      toolCallResponse('integrator-report', 'crew_report', {
        verdict: 'passed',
        summary: 'The reviewed module integrates cleanly.',
        changed_paths: [],
        issues: [],
      }),
      textResponse('Integration review complete.'),
      'hang',
    ]
    const mounted = await setup(repositoryRoot, script, { approval: true })
    const { ctx, lead } = Object.assign(runtime, mounted)

    const dispatched = await ctx.crew.dispatch(lead, {
      moduleKey: 'module',
      subject: 'Implement module',
      description: 'Create one syntax-valid ESM module.',
      specPath: 'specs/module.md',
      specRevision: 1,
      readScopes: ['specs', 'project'],
      writeScopes: ['project/src'],
      requiredArtifacts: ['project/src/index.js'],
      testCommands: [{ id: 'syntax', argv: ['node', '--check', 'src/index.js'], cwd: 'project', timeoutMs: 10_000 }],
      signal: SIGNAL,
    })
    await vi.waitFor(() => {
      expect(ctx.crew.view(lead).workItems[0]?.stage).toBe('integration_ready')
    }, { timeout: 15_000 })
    const reviewed = ctx.crew.view(lead).workItems[0]!
    expect(reviewed.taskId).toBe(dispatched.taskId)
    expect(ctx.crew.view(lead).verifications[0]).toMatchObject({ verdict: 'passed' })
    expect(ctx.crew.view(lead).reviews[0]).toMatchObject({ verdict: 'passed' })

    writeFileSync(join(repositoryRoot, 'project', 'src', 'index.js'), 'export const answer = 43\n')
    await expect(ctx.crew.integrate(lead, { taskIds: [reviewed.taskId], testCommands: [], signal: SIGNAL }))
      .rejects.toMatchObject({ code: 'CREW_STALE_REVISION' })
    expect(ctx.crew.view(lead).integrations).toEqual([])
    writeFileSync(join(repositoryRoot, 'project', 'src', 'index.js'), 'export const answer = 42\n')

    const integration = await ctx.crew.integrate(lead, {
      taskIds: [reviewed.taskId],
      testCommands: [{ id: 'combined-syntax', argv: ['node', '--check', 'src/index.js'], cwd: 'project', timeoutMs: 10_000 }],
      signal: SIGNAL,
    })
    await vi.waitFor(() => {
      const current = ctx.crew.view(lead)
      expect(current.integrations.find(item => item.id === integration.id)?.status).toBe('passed')
      expect(current.workItems[0]?.stage).toBe('accepted')
    }, { timeout: 10_000 })
    const view = ctx.crew.view(lead)
    expect(view.integrations[0]).toMatchObject({
      status: 'passed',
      approvedPaths: ['project/src/index.js'],
    })
    expect(view.integrations[0]?.commands).toMatchObject([{ commandId: 'combined-syntax', exitCode: 0 }])
    expect(lead.session.snapshotEvents().filter(event => event.type === 'crew/report')).toHaveLength(3)
    expect(mounted.adapter.requests).toHaveLength(7)

    lead.ctx.on('approval/request', () => Promise.resolve<'allowed-once'>('allowed-once'))
    lead.session.append('turn/start', { turn: 1 })
    if (localOnly) {
      const commit = await execute(ctx, lead, 'crew_commit', {
        integration_id: integration.id,
        message: 'feat: optional commit',
      })
      expect(commit.isError).toBe(true)
      expect(resultText(commit)).toContain('Local development is complete without a commit')
      expect(ctx.crew.view(lead).commits.at(-1)?.status).toBe('rejected')
      expect(ctx.crew.view(lead).workItems[0]?.stage).toBe('accepted')
      expect(existsSync(join(repositoryRoot, '.git'))).toBe(false)
      return
    }
    const active = await ctx.crew.dispatch(lead, {
      moduleKey: 'active-module',
      subject: 'Hold active work',
      description: 'Keep one disjoint developer active during the commit attempt.',
      specPath: 'specs/module.md',
      specRevision: 1,
      readScopes: ['specs', 'project/active'],
      writeScopes: ['project/active'],
      requiredArtifacts: [],
      testCommands: [],
      signal: SIGNAL,
    })
    const activeCommit = await execute(ctx, lead, 'crew_commit', {
      integration_id: integration.id,
      message: 'feat: must remain blocked',
    })
    expect(activeCommit.isError).toBe(true)
    expect(resultText(activeCommit)).toContain('quiescent workflow')
    const parked = await ctx.crew.stop(lead, {
      taskId: active.taskId, expectedRevision: active.revision, reason: 'Finish the active-work gate test.',
    })
    await ctx.crew.updateWorkItem(lead, {
      taskId: parked.taskId, expectedRevision: parked.revision, stage: 'cancelled',
      reason: 'Test-only terminal cleanup.',
    })

    writeFileSync(join(repositoryRoot, 'project', 'src', 'index.js'), 'export const answer = 43\n')
    const stale = await execute(ctx, lead, 'crew_commit', {
      integration_id: integration.id,
      message: 'feat: add module',
    })
    expect(stale.isError).toBe(true)
    expect(ctx.crew.view(lead).commits.at(-1)).toMatchObject({ status: 'rejected' })

    writeFileSync(join(repositoryRoot, 'project', 'src', 'index.js'), 'export const answer = 42\n')
    execFileSync('git', ['add', '--intent-to-add', '--', 'project/src/index.js'], { cwd: repositoryRoot })
    const changedIndex = await execute(ctx, lead, 'crew_commit', {
      integration_id: integration.id,
      message: 'feat: must reject an altered index',
    })
    expect(changedIndex.isError).toBe(true)
    expect(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim()).toBe('1')
    execFileSync('git', ['update-index', '--force-remove', '--', 'project/src/index.js'], { cwd: repositoryRoot })
    const committed = await execute(ctx, lead, 'crew_commit', {
      integration_id: integration.id,
      message: 'feat: add module',
    })
    expect(committed.isError).not.toBe(true)
    expect(resultText(committed)).toContain('"status":"committed"')
    expect(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim()).toBe('2')
    expect(execFileSync('git', ['status', '--short'], { cwd: repositoryRoot, encoding: 'utf8' })).toBe('')
    expect(execFileSync('git', ['remote'], { cwd: repositoryRoot, encoding: 'utf8' })).toBe('')
    expect(lead.session.snapshotEvents().filter(event => event.type === 'approval/asked')).toHaveLength(4)
  }, WORKFLOW_TIMEOUT_MS)

  it.each([false, true])('checks current module assignments after verification waits (unassigned write: %s)', async (unassignedWrite) => {
    const repositoryRoot = fixtureRepository()
    // Annotated bindings (not withResolvers<void>()): the tests lint layer runs
    // no-invalid-void-type with default options, which rejects the explicit
    // type argument in call position but accepts the inferred form.
    const entered: PromiseWithResolvers<void> = Promise.withResolvers()
    const release: PromiseWithResolvers<void> = Promise.withResolvers()
    // Read through a plain function-typed view so capturing the real
    // implementation for the spy to delegate to is not an unbound method.
    const runCommand = (CrewHost.prototype as { runCommand: HostRunCommand }).runCommand
    const commandSpy = vi.spyOn(CrewHost.prototype, 'runCommand').mockImplementation(async function (this: CrewHost, root, command, signal) {
      if (command.id === 'held-syntax') {
        entered.resolve()
        await release.promise
      }
      return await runCommand.call(this, root, command, signal)
    })
    onTestFinished(() => { release.resolve(); commandSpy.mockRestore() })
    const { ctx, lead } = await setup(repositoryRoot, [
      toolCallResponse('first-write', 'crew_write_file', {
        path: 'project/src/index.js', content: 'export const answer = 42\n',
      }),
      toolCallResponse('first-report', 'crew_report', {
        verdict: 'ready', summary: 'First module ready.', changed_paths: ['project/src/index.js'], issues: [],
      }),
      textResponse('First handoff complete.'),
      'hang',
      'hang',
    ], { maxAutomaticRepairs: 0 })
    const first = await ctx.crew.dispatch(lead, {
      moduleKey: 'first', subject: 'First module', description: 'Verify while another module is dispatched.',
      specPath: 'specs/module.md', specRevision: 1, readScopes: ['specs', 'project/src'],
      writeScopes: ['project/src'], requiredArtifacts: ['project/src/index.js'],
      testCommands: [{ id: 'held-syntax', argv: ['node', '--check', 'src/index.js'], cwd: 'project', timeoutMs: 10_000 }],
      signal: SIGNAL,
    })
    await entered.promise
    try {
      const second = await ctx.crew.dispatch(lead, {
        moduleKey: 'second', subject: 'Second module', description: 'Write inside a newly assigned module.',
        specPath: 'specs/module.md', specRevision: 1, readScopes: ['specs', 'project/second'],
        writeScopes: ['project/second'], requiredArtifacts: [], testCommands: [], signal: SIGNAL,
      })
      const child = ctx.agents.get(second.developerSessionId!)!
      expect((await execute(ctx, child, 'crew_write_file', {
        path: 'project/second/index.js', content: 'export const second = 1\n',
      })).isError).toBe(false)
      if (unassignedWrite) writeFileSync(join(repositoryRoot, 'project', 'README.md'), 'unassigned modification\n')
    } finally {
      release.resolve()
    }
    await vi.waitFor(() => {
      expect(ctx.crew.view(lead).verifications.find(item => item.taskId === first.taskId)).toBeDefined()
    }, { timeout: 10_000 })
    expect(ctx.crew.view(lead).verifications.find(item => item.taskId === first.taskId)).toMatchObject({
      verdict: unassignedWrite ? 'failed' : 'passed',
      changedPaths: ['project/src/index.js'],
      outOfScopePaths: unassignedWrite ? ['project/README.md'] : [],
    })
  }, WORKFLOW_TIMEOUT_MS)

  it.each([false, true])('rejects changes made during declared tests (localOnly=%s)', async (localOnly) => {
    const repositoryRoot = fixtureRepository(localOnly)
    const { ctx, lead } = await setup(repositoryRoot, [
      toolCallResponse('write-mutating-test', 'crew_write_file', {
        path: 'project/src/test.mjs',
        content: "import { writeFileSync } from 'node:fs'; writeFileSync('README.md', 'changed during test\\n')\n",
      }),
      toolCallResponse('report-before-test', 'crew_report', {
        verdict: 'ready', summary: 'The declared test returns zero.',
        changed_paths: ['project/src/test.mjs'], issues: [],
      }),
      textResponse('Handoff complete.'),
      'hang',
    ], { maxAutomaticRepairs: 0 })
    await ctx.crew.dispatch(lead, {
      moduleKey: 'module', subject: 'Test verification', description: 'Verify the checkout after commands run.',
      specPath: 'specs/module.md', specRevision: 1, readScopes: ['specs', 'project/src'],
      writeScopes: ['project/src'], requiredArtifacts: ['project/src/test.mjs'],
      testCommands: [{ id: 'mutating-test', argv: ['node', 'src/test.mjs'], cwd: 'project', timeoutMs: 10_000 }],
      signal: SIGNAL,
    })
    await vi.waitFor(() => {
      expect(ctx.crew.view(lead).workItems[0]?.stage).toMatch(/^(paused|reviewing)$/u)
    }, { timeout: 10_000 })
    const view = ctx.crew.view(lead)
    expect(view.workItems[0]?.stage).toBe('paused')
    expect(view.verifications[0]).toMatchObject({ verdict: 'failed' })
    expect(view.verifications[0]?.summary).toMatch(/paths escaped|test mutating-test failed/u)
    expect(view.reviews).toEqual([])
  }, WORKFLOW_TIMEOUT_MS)

  it('rejects a passing reviewer report when the frozen module changed during review', async () => {
    const repositoryRoot = fixtureRepository()
    const runtime = {} as { ctx: Context; lead: Agent }
    const mounted = await setup(repositoryRoot, [
      toolCallResponse('write-reviewed-module', 'crew_write_file', {
        path: 'project/src/index.js', content: 'export const answer = 42\n',
      }),
      toolCallResponse('report-reviewed-module', 'crew_report', {
        verdict: 'ready', summary: 'Module ready.', changed_paths: ['project/src/index.js'], issues: [],
      }),
      textResponse('Handoff complete.'),
      () => {
        const verificationId = runtime.ctx.crew.view(runtime.lead).workItems[0]?.latestVerificationId
        if (verificationId === undefined) throw new Error('expected a verified review input')
        // This writer represents an external checkout edit, not an authorized reviewer tool.
        writeFileSync(join(repositoryRoot, 'project', 'src', 'index.js'), 'export const answer = 99\n')
        return toolCallResponse('pass-stale-review', 'crew_report', {
          verdict: 'passed', summary: 'Passed.', changed_paths: [], issues: [], verification_id: verificationId,
        })
      },
      textResponse('Review complete.'),
    ], { maxReviewRounds: 1 })
    const { ctx, lead } = Object.assign(runtime, mounted)
    await ctx.crew.dispatch(lead, {
      moduleKey: 'module', subject: 'Review input integrity', description: 'Reject stale reviewer evidence.',
      specPath: 'specs/module.md', specRevision: 1, readScopes: ['specs', 'project/src'],
      writeScopes: ['project/src'], requiredArtifacts: ['project/src/index.js'], testCommands: [], signal: SIGNAL,
    })
    await vi.waitFor(() => {
      expect(ctx.crew.view(lead).reviews).toHaveLength(1)
    }, { timeout: 10_000 })
    expect(ctx.crew.view(lead).reviews[0]).toMatchObject({
      verdict: 'rejected', summary: 'Module inputs changed after host verification.',
    })
  }, WORKFLOW_TIMEOUT_MS)

  it('returns a rejected review to the same developer Session before accepting the repair', async () => {
    const repositoryRoot = fixtureRepository()
    const runtime = {} as { ctx: Context; lead: Agent }
    const script: ConstructorParameters<typeof MockAdapter>[0] = [
      toolCallResponse('write-first', 'crew_write_file', {
        path: 'project/src/index.js', content: 'export const answer = 42\n',
      }),
      toolCallResponse('report-first', 'crew_report', {
        verdict: 'ready', summary: 'First implementation.', changed_paths: ['project/src/index.js'], issues: [],
      }),
      textResponse('First handoff.'),
      () => toolCallResponse('review-reject', 'crew_report', {
        verdict: 'rejected',
        summary: 'The answer must be 43.',
        changed_paths: [],
        issues: [{
          path: 'project/src/index.js', line: 1, message: 'Wrong answer.', expected: 'Export 43.',
        }],
        verification_id: runtime.ctx.crew.view(runtime.lead).workItems[0]!.latestVerificationId,
      }),
      textResponse('Review rejected.'),
      toolCallResponse('edit-repair', 'crew_edit_file', {
        path: 'project/src/index.js', old_string: '42', new_string: '43', replace_all: false,
      }),
      toolCallResponse('report-repair', 'crew_report', {
        verdict: 'ready', summary: 'Corrected the answer.', changed_paths: ['project/src/index.js'], issues: [],
      }),
      textResponse('Repair handoff.'),
      () => toolCallResponse('review-pass', 'crew_report', {
        verdict: 'passed', summary: 'Repair matches the specification.', changed_paths: [], issues: [],
        verification_id: runtime.ctx.crew.view(runtime.lead).workItems[0]!.latestVerificationId,
      }),
      textResponse('Review passed.'),
    ]
    const mounted = await setup(repositoryRoot, script)
    const { ctx, lead } = Object.assign(runtime, mounted)
    const dispatched = await ctx.crew.dispatch(lead, {
      moduleKey: 'module', subject: 'Implement module', description: 'Export the accepted answer.',
      specPath: 'specs/module.md', specRevision: 1, readScopes: ['specs', 'project'],
      writeScopes: ['project/src'], requiredArtifacts: ['project/src/index.js'],
      testCommands: [{ id: 'syntax', argv: ['node', '--check', 'src/index.js'], cwd: 'project', timeoutMs: 10_000 }],
      signal: SIGNAL,
    })
    await vi.waitFor(() => {
      const current = ctx.crew.view(lead)
      expect(current.workItems[0]?.stage, JSON.stringify({ work: current.workItems, reviews: current.reviews, reports: current.reports })).toBe('integration_ready')
    }, { timeout: 20_000 })
    const view = ctx.crew.view(lead)
    expect(view.workItems[0]).toMatchObject({
      developerSessionId: dispatched.developerSessionId,
      attempt: 2,
      stage: 'integration_ready',
    })
    expect(view.workItems[0]!.workerSessionIds.filter(id => id === dispatched.developerSessionId)).toHaveLength(1)
    expect(view.reviews.map(review => review.verdict)).toEqual(['rejected', 'passed'])
    expect(ctx.agentTeams.listMembers(lead).filter(member => member.name.startsWith('developer-'))).toHaveLength(1)
  }, WORKFLOW_TIMEOUT_MS)

  it('automatically requests one host-verification repair and then durably pauses at the limit', async () => {
    const repositoryRoot = fixtureRepository()
    const script: ConstructorParameters<typeof MockAdapter>[0] = [
      toolCallResponse('report-missing-first', 'crew_report', {
        verdict: 'ready', summary: 'Claimed completion without the required artifact.', changed_paths: [], issues: [],
      }),
      textResponse('First incomplete handoff.'),
      toolCallResponse('report-missing-second', 'crew_report', {
        verdict: 'ready', summary: 'Repeated the incomplete handoff.', changed_paths: [], issues: [],
      }),
      textResponse('Second incomplete handoff.'),
    ]
    const { ctx, lead } = await setup(repositoryRoot, script, { maxAutomaticRepairs: 1 })
    const dispatched = await ctx.crew.dispatch(lead, {
      moduleKey: 'module', subject: 'Implement module', description: 'Create the required artifact.',
      specPath: 'specs/module.md', specRevision: 1, readScopes: ['specs', 'project'],
      writeScopes: ['project/src'], requiredArtifacts: ['project/src/missing.js'],
      testCommands: [], signal: SIGNAL,
    })

    await vi.waitFor(() => {
      expect(ctx.crew.view(lead).workItems[0]?.stage).toBe('paused')
    }, { timeout: 10_000 })
    const view = ctx.crew.view(lead)
    expect(view.workItems[0]).toMatchObject({
      developerSessionId: dispatched.developerSessionId,
      attempt: 2,
      automaticRepairCount: 1,
      stage: 'paused',
    })
    expect(view.verifications.map(item => item.verdict)).toEqual(['failed', 'failed'])
    expect(view.verifications.every(item => item.missingArtifacts.includes('project/src/missing.js'))).toBe(true)
    expect(view.workItems[0]!.workerSessionIds.filter(id => id === dispatched.developerSessionId)).toHaveLength(1)
    expect(ctx.agentTeams.listMembers(lead).filter(member => member.name.startsWith('developer-'))).toHaveLength(1)
  }, 20_000)

  it('batches multiple actionable worker edges into one durable manager turn', async () => {
    const repositoryRoot = fixtureRepository()
    const { ctx, lead } = await setup(repositoryRoot, [
      'hang',
      'hang',
      textResponse('Manager acknowledged both parked workers.'),
    ], { notificationBatchWindowMs: 20 })
    const first = await ctx.crew.dispatch(lead, {
      moduleKey: 'module-a', subject: 'Module A', description: 'Hold Module A.',
      specPath: 'specs/module.md', specRevision: 1, readScopes: ['specs', 'project/src/a'],
      writeScopes: ['project/src/a'], requiredArtifacts: [], testCommands: [], signal: SIGNAL,
    })
    const second = await ctx.crew.dispatch(lead, {
      moduleKey: 'module-b', subject: 'Module B', description: 'Hold Module B.',
      specPath: 'specs/module.md', specRevision: 1, readScopes: ['specs', 'project/src/b'],
      writeScopes: ['project/src/b'], requiredArtifacts: [], testCommands: [], signal: SIGNAL,
    })
    await ctx.crew.stop(lead, {
      taskId: second.taskId, expectedRevision: second.revision, reason: 'Second worker needs action.',
    })
    await ctx.crew.stop(lead, {
      taskId: first.taskId, expectedRevision: first.revision, reason: 'First worker needs action.',
    })

    await vi.waitFor(() => {
      expect(ctx.crew.view(lead).notifications).toMatchObject([{ status: 'delivered' }])
    }, { timeout: 10_000 })
    const notifications = ctx.crew.view(lead).notifications
    expect(notifications).toHaveLength(1)
    expect(notifications[0]?.sourceEventSeqs).toHaveLength(2)
    expect(notifications[0]?.content).toContain('module-a')
    expect(notifications[0]?.content).toContain('module-b')
    expect(lead.session.snapshotEvents().filter(event => (
      event.type === 'user/message' && event.data.source.kind === 'crew-notification'
    ))).toHaveLength(1)
  })

  it('persists one manager notification delivery across restart', async () => {
    const repositoryRoot = fixtureRepository()
    const store: MemoryStore = { records: new Map() }
    const first = await setup(repositoryRoot, ['hang', textResponse('Manager acknowledged.')], {
      managerId: 'crew-notification-manager',
      notificationBatchWindowMs: 10,
      store,
    })
    const work = await first.ctx.crew.dispatch(first.lead, {
      moduleKey: 'module', subject: 'Pause module', description: 'Wait for a stop.',
      specPath: 'specs/module.md', specRevision: 1, readScopes: ['specs', 'project'],
      writeScopes: ['project/src'], requiredArtifacts: [], testCommands: [], signal: SIGNAL,
    })
    await first.ctx.crew.stop(first.lead, {
      taskId: work.taskId, expectedRevision: work.revision, reason: 'Needs manager action.',
    })
    await vi.waitFor(() => {
      expect(first.ctx.crew.view(first.lead).notifications).toMatchObject([{ status: 'delivered' }])
    }, { timeout: 10_000 })
    const before = first.lead.session.snapshotEvents().filter(event => (
      event.type === 'user/message' && event.data.source.kind === 'crew-notification'
    ))
    expect(before).toHaveLength(1)
    await first.ctx.fiber.dispose()
    contexts.delete(first.ctx)

    const second = await setup(repositoryRoot, [], {
      managerId: 'crew-notification-manager',
      notificationBatchWindowMs: 10,
      resume: true,
      store,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(second.ctx.crew.view(second.lead).notifications).toMatchObject([{ status: 'delivered' }])
    expect(second.lead.session.snapshotEvents().filter(event => (
      event.type === 'user/message' && event.data.source.kind === 'crew-notification'
    ))).toHaveLength(1)
    expect(second.adapter.requests).toHaveLength(0)
  })

  it('reconstructs an actionable notification when restart happens before its batch is persisted', async () => {
    const repositoryRoot = fixtureRepository()
    const store: MemoryStore = { records: new Map() }
    const first = await setup(repositoryRoot, ['hang'], {
      managerId: 'crew-notification-before-batch',
      notificationBatchWindowMs: 1_000,
      store,
    })
    const work = await first.ctx.crew.dispatch(first.lead, {
      moduleKey: 'module', subject: 'Pause module', description: 'Wait for a stop.',
      specPath: 'specs/module.md', specRevision: 1, readScopes: ['specs', 'project'],
      writeScopes: ['project/src'], requiredArtifacts: [], testCommands: [], signal: SIGNAL,
    })
    await first.ctx.crew.stop(first.lead, {
      taskId: work.taskId, expectedRevision: work.revision, reason: 'Recover this actionable edge.',
    })
    expect(first.ctx.crew.view(first.lead).notifications).toEqual([])
    const crashStore = cloneStore(store)
    await first.ctx.fiber.dispose()
    contexts.delete(first.ctx)

    const second = await setup(repositoryRoot, [textResponse('Manager recovered the notification.')], {
      managerId: 'crew-notification-before-batch',
      resume: true,
      store: crashStore,
    })
    await vi.waitFor(() => {
      expect(second.ctx.crew.view(second.lead).notifications).toMatchObject([{ status: 'delivered' }])
    }, { timeout: 10_000 })
    expect(second.lead.session.snapshotEvents().filter(event => (
      event.type === 'user/message' && event.data.source.kind === 'crew-notification'
    ))).toHaveLength(1)
  }, 15_000)

  it('delivers a persisted queued notification once after restart', async () => {
    const repositoryRoot = fixtureRepository()
    const store: MemoryStore = { records: new Map() }
    const first = await setup(repositoryRoot, ['hang'], {
      managerId: 'crew-notification-after-queue',
      store,
    })
    const work = await first.ctx.crew.dispatch(first.lead, {
      moduleKey: 'module', subject: 'Pause module', description: 'Wait for a stop.',
      specPath: 'specs/module.md', specRevision: 1, readScopes: ['specs', 'project'],
      writeScopes: ['project/src'], requiredArtifacts: [], testCommands: [], signal: SIGNAL,
    })
    await first.ctx.crew.stop(first.lead, {
      taskId: work.taskId, expectedRevision: work.revision, reason: 'Persist a queued notification.',
    })
    const queued = appendCrashNotification(first.lead, 'after-queue', false)
    await first.ctx.sessions.flush(first.lead.session)
    const crashStore = cloneStore(store)
    await first.ctx.fiber.dispose()
    contexts.delete(first.ctx)

    const second = await setup(repositoryRoot, [textResponse('Manager received the queued notification.')], {
      managerId: 'crew-notification-after-queue',
      resume: true,
      store: crashStore,
    })
    await vi.waitFor(() => {
      expect(second.ctx.crew.view(second.lead).notifications.find(item => item.id === queued.id)?.status)
        .toBe('delivered')
    }, { timeout: 10_000 })
    await second.lead.whenIdle()
    expect(second.lead.session.snapshotEvents().filter(event => (
      event.type === 'user/message' && event.data.source.kind === 'crew-notification'
        && event.data.source.notificationId === queued.id
    ))).toHaveLength(1)
  })

  it('acknowledges an observed notification after restart without appending it again', async () => {
    const repositoryRoot = fixtureRepository()
    const store: MemoryStore = { records: new Map() }
    const first = await setup(repositoryRoot, ['hang'], {
      managerId: 'crew-notification-after-message',
      store,
    })
    const work = await first.ctx.crew.dispatch(first.lead, {
      moduleKey: 'module', subject: 'Pause module', description: 'Wait for a stop.',
      specPath: 'specs/module.md', specRevision: 1, readScopes: ['specs', 'project'],
      writeScopes: ['project/src'], requiredArtifacts: [], testCommands: [], signal: SIGNAL,
    })
    await first.ctx.crew.stop(first.lead, {
      taskId: work.taskId, expectedRevision: work.revision, reason: 'Persist the manager input first.',
    })
    const queued = appendCrashNotification(first.lead, 'after-message', true)
    await first.ctx.sessions.flush(first.lead.session)
    const crashStore = cloneStore(store)
    await first.ctx.fiber.dispose()
    contexts.delete(first.ctx)

    const second = await setup(repositoryRoot, [textResponse('Recovered manager input.')], {
      managerId: 'crew-notification-after-message',
      resume: true,
      store: crashStore,
    })
    await vi.waitFor(() => {
      expect(second.ctx.crew.view(second.lead).notifications.find(item => item.id === queued.id)?.status)
        .toBe('delivered')
    }, { timeout: 10_000 })
    expect(second.lead.session.snapshotEvents().filter(event => (
      event.type === 'user/message' && event.data.source.kind === 'crew-notification'
        && event.data.source.notificationId === queued.id
    ))).toHaveLength(1)
  })
})
