import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantService, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { teamProjectionDefinition } from '@deepseek-ai/dsh-agent-team/projection'
import { TeamId, TeamTaskId } from '@deepseek-ai/dsh-agent-team'
import * as CrewInvariant from '../src/invariant.ts'
import { crewProjectionDefinition } from '../src/projection.ts'
import type { CrewConfigurationSnapshot, CrewWorkItemSnapshot } from '../src/types.ts'

const ROOT = SessionId('crew-invariant-root')
const TASK = TeamTaskId('task-1')

const configuration: CrewConfigurationSnapshot = {
  repositoryRoot: 'C:/repo',
  nativeProvider: 'spawn',
  maxConcurrentWorkers: 2,
  notificationBatchWindowMs: 25,
  workerTurnTimeoutMs: 1_000,
  maxAutomaticRepairs: 1,
  maxReviewRounds: 2,
  allowedTestPrograms: ['pnpm'],
  sharedDirectories: ['docs', 'test', 'tests'],
  execution: {
    maxOutputBytes: 4096, processGraceMs: 1000, gitTimeoutMs: 10_000,
  },
  commitPolicy: { maxMessageLength: 72, requireNamedBranch: true },
  roles: {
    developer: { role: 'developer', persona: 'Develop.', toolFilter: { allow: ['crew_*'] }, agentOptions: {}, maxDepth: 1 },
    reviewer: { role: 'reviewer', persona: 'Review.', toolFilter: { allow: ['crew_*'] }, agentOptions: {}, maxDepth: 1 },
    integrator: { role: 'integrator', persona: 'Integrate.', toolFilter: { allow: ['crew_*'] }, agentOptions: {}, maxDepth: 1 },
  },
}

const planned: CrewWorkItemSnapshot = {
  taskId: TASK,
  revision: 1,
  moduleKey: 'module-a',
  specPath: 'specs/module-a.md',
  specRevision: 1,
  readScopes: ['packages/shared'],
  writeScopes: ['packages/module-a'],
  requiredArtifacts: ['packages/module-a/src/index.ts'],
  testCommands: [],
  baseline: {
    head: 'abc',
    branch: 'main',
    statusDigest: 'clean',
    changedPaths: [],
    stagedPaths: [],
    pathDigests: {},
  },
  stage: 'planned',
  workerSessionIds: [],
  attempt: 1,
  automaticRepairCount: 0,
  reviewRound: 0,
}

async function setup() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(teamProjectionDefinition)
  ctx.sessionProjections.register(crewProjectionDefinition)
  await ctx.plugin(InvariantService, { enabled: true })
  await ctx.plugin(CrewInvariant)
  return { ctx, session: ctx.sessions.create(ROOT) }
}

function appendConfiguration(session: ReturnType<Context['sessions']['create']>): void {
  session.append('crew/configuration', { version: 1, teamId: TeamId(ROOT), configuration })
}

function appendTeamTask(
  session: ReturnType<Context['sessions']['create']>,
  revision = 1,
  writeScopes = ['packages/module-a'],
): void {
  session.append('team/task', {
    version: 2,
    teamId: TeamId(ROOT),
    task: {
      id: TASK,
      revision,
      subject: 'Module A',
      description: 'Implement Module A.',
      status: 'pending',
      blockedBy: [],
      writeScopes,
    },
  })
}

describe('Crew cross-domain invariant', () => {
  it('accepts a Crew work item backed by the matching Team task', async () => {
    const { session } = await setup()
    appendConfiguration(session)
    appendTeamTask(session)
    expect(() => {
      session.append('crew/work-item', { version: 1, teamId: TeamId(ROOT), workItem: planned })
    }).not.toThrow()
  })

  it('rejects an orphan Crew work item before publication', async () => {
    const { session } = await setup()
    appendConfiguration(session)
    expect(() => {
      session.append('crew/work-item', { version: 1, teamId: TeamId(ROOT), workItem: planned })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-crew',
    }))
    expect(session.snapshotEvents().map(event => event.type)).toEqual(['crew/configuration'])
  })

  it('rejects Team scope drift after a Crew binding exists', async () => {
    const { session } = await setup()
    appendConfiguration(session)
    appendTeamTask(session)
    session.append('crew/work-item', { version: 1, teamId: TeamId(ROOT), workItem: planned })

    expect(() => { appendTeamTask(session, 2, ['packages/other']) }).toThrow(
      expect.objectContaining<Partial<InvariantError>>({
        code: 'INVARIANT',
        packageName: '@deepseek-ai/dsh-crew',
      }),
    )
    expect(session.snapshotEvents().filter(event => event.type === 'team/task')).toHaveLength(1)
  })

  it('rejects a running Crew stage while the Team task remains pending', async () => {
    const { session } = await setup()
    appendConfiguration(session)
    appendTeamTask(session)
    session.append('crew/work-item', { version: 1, teamId: TeamId(ROOT), workItem: planned })
    const child = SessionId('crew-developer')
    const queued: CrewWorkItemSnapshot = {
      ...planned,
      revision: 2,
      stage: 'queued',
      developerName: 'developer',
      developerSessionId: child,
      workerSessionIds: [child],
    }
    session.append('crew/work-item', { version: 1, teamId: TeamId(ROOT), workItem: queued })
    expect(() => {
      session.append('crew/work-item', {
        version: 1,
        teamId: TeamId(ROOT),
        workItem: { ...queued, revision: 3, stage: 'running' },
      })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-crew',
    }))
  })
})
