import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import {
  SessionId,
  SessionLogOffset,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import {
  SessionAlreadyExistsError,
  SessionPersistence,
  SessionPersistenceNotFoundError,
  SessionPersistenceRevision,
  type SessionAccess,
  type SessionHandle,
  type SessionPersistenceSnapshot,
} from '@deepseek-ai/dsh-session-persistence'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import TeamService from '@deepseek-ai/dsh-agent-team'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import CrewService from '../src/index.ts'

const contexts = new Set<Context>()

function baseline() {
  return {
    head: 'abc123',
    branch: 'main',
    statusDigest: 'baseline-digest',
    changedPaths: [],
    stagedPaths: [],
    pathDigests: {},
  }
}

interface MemoryRecord {
  readonly header: SessionHeader
  readonly inheritedEventCount: SessionLogOffset
  readonly events: SessionEvent[]
}

interface MemoryStore {
  readonly records: Map<SessionId, MemoryRecord>
}

/** Deterministic handle persistence used to exercise Crew replay without filesystem locks. */
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
      revision: SessionPersistenceRevision(`crew-memory-${record.header.id}-${record.events.length}`),
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
      read: async (offset = 0, length = Number.MAX_SAFE_INTEGER) => structuredClone(record.events.slice(offset, offset + length)),
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

async function stack(store: MemoryStore, repositoryRoot = process.cwd()) {
  const ctx = new Context()
  contexts.add(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(MemoryPersistence, store)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(TeamService)
  const crewFiber = await ctx.plugin(CrewService, { repositoryRoot })
  ctx.llm.registerAdapter(['mock'], new MockAdapter([]))
  return { ctx, crewFiber }
}

async function lead(ctx: Context, id = 'crew-manager'): Promise<Agent> {
  return await ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' }, { cwd: process.cwd() })
}

it('retains Crew task records but refuses new work after application exit preparation', async () => {
  const store: MemoryStore = { records: new Map() }
  const { ctx } = await stack(store)
  const manager = await lead(ctx)
  await createBoundWork(ctx, manager, 'desktop', 'modules/desktop')
  const record = store.records.get(manager.id)
  expect(record?.events.some(event => event.type === 'crew/work-item')).toBe(true)
  await ctx.parallel('app/prepare-exit', 'producers')
  await expect(ctx.crew.ensureConfigured(manager)).rejects.toThrow('Crew service disposed')
  await ctx.parallel('app/prepare-exit', 'agents')
  expect(ctx.agents.list()).toEqual([])
  expect(record?.events.some(event => event.type === 'crew/work-item')).toBe(true)
})

async function createBoundWork(
  ctx: Context,
  manager: Agent,
  name: string,
  scope: string,
) {
  const task = await ctx.agentTeams.createTask(manager, {
    subject: `${name} implementation`,
    description: `Implement ${name} from its frozen specification.`,
    writeScopes: [scope],
  })
  return await ctx.crew.createWorkItem(manager, {
    taskId: task.id,
    moduleKey: name,
    specPath: `specs/${name}.md`,
    specRevision: 1,
    readScopes: ['specs', scope],
    writeScopes: [scope],
    requiredArtifacts: [`${scope}/src/index.ts`],
    testCommands: [{
      id: 'unit',
      argv: ['pnpm', 'run', 'test', '--', name],
      cwd: scope,
      timeoutMs: 30_000,
    }],
    baseline: baseline(),
  })
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
  if (failures.length > 0) throw new AggregateError(failures, 'Crew test cleanup failed')
})

describe('Crew service persistence and authorization', () => {
  it('rejects invalid transitions before they can enter the manager log', async () => {
    const store: MemoryStore = { records: new Map() }
    const { ctx } = await stack(store)
    const manager = await lead(ctx)
    const initial = await createBoundWork(ctx, manager, 'module-a', 'packages/module-a')
    const before = manager.session.snapshotEvents().length

    await expect(ctx.crew.updateWorkItem(manager, {
      taskId: initial.taskId,
      expectedRevision: initial.revision,
      stage: 'running',
    })).rejects.toMatchObject({ code: 'CREW_INVALID_TRANSITION' })
    expect(manager.session.snapshotEvents()).toHaveLength(before)
    expect(ctx.crew.view(manager).workItems[0]).toMatchObject({ revision: 1, stage: 'planned' })
  })

  it('serializes competing CAS updates and returns detached views', async () => {
    const store: MemoryStore = { records: new Map() }
    const { ctx } = await stack(store)
    const manager = await lead(ctx)
    const initial = await createBoundWork(ctx, manager, 'module-a', 'packages/module-a')

    const updates = await Promise.allSettled([
      ctx.crew.updateWorkItem(manager, {
        taskId: initial.taskId,
        expectedRevision: initial.revision,
        stage: 'queued',
      }),
      ctx.crew.updateWorkItem(manager, {
        taskId: initial.taskId,
        expectedRevision: initial.revision,
        stage: 'queued',
      }),
    ])

    expect(updates.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = updates.find(result => result.status === 'rejected')
    expect(rejected).toMatchObject({ reason: { code: 'CREW_STALE_REVISION' } })
    const view = ctx.crew.view(manager)
    expect(view.workItems[0]).toMatchObject({ revision: 2, stage: 'queued' })
    view.workItems[0]!.writeScopes.push('mutated-client-copy')
    expect(ctx.crew.view(manager).workItems[0]!.writeScopes).toEqual(['packages/module-a'])
  })

  it('rejects duplicate, mismatched, overlapping, and unauthorized work', async () => {
    const store: MemoryStore = { records: new Map() }
    const { ctx } = await stack(store)
    const manager = await lead(ctx)
    const first = await createBoundWork(ctx, manager, 'module-a', 'packages/module-a')

    await expect(ctx.crew.createWorkItem(manager, {
      taskId: first.taskId,
      moduleKey: 'module-a-copy',
      specPath: 'specs/module-a-copy.md',
      specRevision: 1,
      readScopes: [],
      writeScopes: ['packages/module-a'],
      requiredArtifacts: [],
      testCommands: [],
      baseline: baseline(),
    })).rejects.toMatchObject({ code: 'CREW_WORK_ITEM_EXISTS' })

    const overlapping = await ctx.agentTeams.createTask(manager, {
      subject: 'overlap', description: 'overlap', writeScopes: ['packages/module-a/src'],
    })
    await expect(ctx.crew.createWorkItem(manager, {
      taskId: overlapping.id,
      moduleKey: 'overlap',
      specPath: 'specs/overlap.md',
      specRevision: 1,
      readScopes: [],
      writeScopes: ['packages/module-a/src'],
      requiredArtifacts: [],
      testCommands: [],
      baseline: baseline(),
    })).rejects.toMatchObject({ code: 'CREW_SCOPE_OVERLAP' })

    const mismatched = await ctx.agentTeams.createTask(manager, {
      subject: 'mismatch', description: 'mismatch', writeScopes: ['packages/team-scope'],
    })
    await expect(ctx.crew.createWorkItem(manager, {
      taskId: mismatched.id,
      moduleKey: 'mismatch',
      specPath: 'specs/mismatch.md',
      specRevision: 1,
      readScopes: [],
      writeScopes: ['packages/crew-scope'],
      requiredArtifacts: [],
      testCommands: [],
      baseline: baseline(),
    })).rejects.toMatchObject({ code: 'CREW_TEAM_TASK_MISMATCH' })
  })

  it('reconstructs the same projection after a cold manager resume', async () => {
    const store: MemoryStore = { records: new Map() }
    const first = await stack(store)
    const manager = await lead(first.ctx, 'crew-replay-manager')
    const work = await createBoundWork(first.ctx, manager, 'module-a', 'packages/module-a')
    await first.ctx.crew.updateWorkItem(manager, {
      taskId: work.taskId,
      expectedRevision: work.revision,
      stage: 'queued',
    })
    const expected = first.ctx.crew.view(manager)
    await first.ctx.sessions.flush(manager.session)
    expect(store.records.get(manager.id)?.events.map(event => event.type)).toContain('crew/configuration')
    await first.ctx.fiber.dispose()
    contexts.delete(first.ctx)

    const second = await stack(store)
    const resumed = await second.ctx.agents.resume({
      resumeSessionId: SessionId('crew-replay-manager'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    expect(resumed.agent.session.snapshotEvents().map(event => event.type)).toContain('crew/configuration')
    expect(second.ctx.crew.view(resumed.agent)).toEqual(expected)
  })

  it('unregisters and remounts its projection without duplicating state', async () => {
    const store: MemoryStore = { records: new Map() }
    const { ctx, crewFiber } = await stack(store)
    const manager = await lead(ctx, 'crew-hmr-manager')
    await createBoundWork(ctx, manager, 'module-a', 'packages/module-a')
    const expected = ctx.crew.view(manager)

    await crewFiber.dispose()
    expect(ctx.sessionProjections.stateOf(manager.session, 'crew')).toBeUndefined()
    await ctx.plugin(CrewService, { repositoryRoot: 'C:/workspace/crew-fixture' })
    expect(ctx.crew.view(manager)).toEqual(expected)
  })
})
