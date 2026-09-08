import { describe, expect, it } from 'vitest'
import { SessionId, SessionSeq, type SessionEvent, type SessionEventMap } from '@deepseek-ai/dsh-session'
import { TeamId, TeamTaskId } from '@deepseek-ai/dsh-agent-team'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import CrewService, {
  CrewIntegrationId,
  CrewNotificationId,
  CrewReportId,
  CrewReviewId,
  CrewVerificationId,
  type CrewConfigurationSnapshot,
  type CrewNotificationSnapshot,
  type CrewWorkItemSnapshot,
} from '../src/index.ts'
import { crewProjectionDefinition, type CrewEventType } from '../src/projection.ts'
import { parsePorcelain } from '../src/host.ts'
import { canTransitionCrewStage, crewStageSuccessors } from '../src/transition.ts'
import {
  crewCheckout,
  crewCommand,
  crewScopesOverlap,
  pathInCrewScope,
  repositoryPath,
} from '../src/validation.ts'

const ROOT = SessionId('crew-root')
const TEAM = TeamId(ROOT)
const TASK = TeamTaskId('task-1')

function configuration(): CrewConfigurationSnapshot {
  const preset = (role: 'developer' | 'reviewer' | 'integrator') => ({
    role,
    persona: `${role} persona`,
    toolFilter: { allow: [] },
    agentOptions: {},
    maxDepth: 1,
  })
  return {
    repositoryRoot: 'C:/workspace/project',
    nativeProvider: 'spawn',
    maxConcurrentWorkers: 2,
    notificationBatchWindowMs: 50,
    workerTurnTimeoutMs: 10_000,
    maxAutomaticRepairs: 1,
    maxReviewRounds: 2,
    allowedTestPrograms: ['pnpm', 'node'],
    sharedDirectories: ['docs', 'test', 'tests'],
    execution: {
      maxOutputBytes: 4096, processGraceMs: 1000, gitTimeoutMs: 10_000,
    },
    commitPolicy: { maxMessageLength: 200, requireNamedBranch: true },
    roles: {
      developer: preset('developer'),
      reviewer: preset('reviewer'),
      integrator: preset('integrator'),
    },
  }
}

function work(overrides: Partial<CrewWorkItemSnapshot> = {}): CrewWorkItemSnapshot {
  return {
    taskId: TASK,
    revision: 1,
    moduleKey: 'module-a',
    specPath: 'specs/module-a.md',
    specRevision: 1,
    readScopes: ['shared'],
    writeScopes: ['packages/module-a'],
    requiredArtifacts: ['packages/module-a/src/index.ts'],
    testCommands: [{ id: 'unit', argv: ['pnpm', 'run', 'test', '--', 'module-a'], cwd: 'packages/module-a', timeoutMs: 10_000 }],
    baseline: {
      head: 'abc123',
      branch: 'main',
      statusDigest: 'baseline-digest',
      changedPaths: [],
      stagedPaths: [],
      pathDigests: {},
    },
    stage: 'planned',
    workerSessionIds: [],
    attempt: 1,
    automaticRepairCount: 0,
    reviewRound: 0,
    ...overrides,
  }
}

function event<T extends CrewEventType>(
  type: T,
  data: SessionEventMap[T],
  seq: number,
): SessionEvent<T> {
  return { type, data, seq: SessionSeq(seq), time: seq } as unknown as SessionEvent<T>
}

function project(events: readonly SessionEvent[]) {
  let state = crewProjectionDefinition.init({ id: ROOT } as never)
  for (const item of events) state = crewProjectionDefinition.apply(state, item)
  return state
}

const configured = event('crew/configuration', { version: 1, teamId: TEAM, configuration: configuration() }, 0)

describe('Crew M0 workflow contract', () => {
  it('replays local-file evidence and refuses invented Git metadata', () => {
    const baseline = { head: null, statusDigest: 'local-digest', changedPaths: ['input.txt'], stagedPaths: [], pathDigests: { 'input.txt': 'content-digest' } }
    expect(crewCheckout(baseline)).toEqual(baseline)
    const local = event('crew/work-item', { version: 1, teamId: TEAM, workItem: work({ baseline }) }, 1)
    expect(project([configured, local]).failure).toBeUndefined()
    expect(project([configured, local]).workItems[0]?.baseline).toEqual(baseline)
    for (const invalid of [{ ...baseline, branch: 'main' }, { ...baseline, stagedPaths: ['input.txt'] }]) {
      expect(() => crewCheckout(invalid)).toThrow('local file evidence')
      const malformed = event('crew/work-item', { version: 1, teamId: TEAM, workItem: work({ baseline: invalid }) }, 1)
      expect(project([configured, malformed]).failure).toBeDefined()
    }
  })
  it('publishes a new wire value when configuration changes', () => {
    const initial = crewProjectionDefinition.init({ id: ROOT } as never)
    const projected = crewProjectionDefinition.apply(initial, configured)

    expect(projected).not.toBe(initial)
    expect(crewProjectionDefinition.wire.view(projected)).toMatchObject({
      configured: true,
      repositoryRoot: 'C:/workspace/project',
    })
  })

  it('pins the complete closed transition table', () => {
    expect(crewStageSuccessors('planned')).toEqual(['queued', 'cancelled'])
    expect(crewStageSuccessors('running')).toEqual(['verifying', 'paused', 'failed', 'cancelled'])
    expect(crewStageSuccessors('accepted')).toEqual([])
    expect(canTransitionCrewStage('revision_required', 'running')).toBe(true)
    expect(canTransitionCrewStage('running', 'accepted')).toBe(false)
  })

  it('rejects a skipped stage and a stale replay revision', () => {
    const initial = event('crew/work-item', { version: 1, teamId: TEAM, workItem: work() }, 1)
    const skipped = event('crew/work-item', {
      version: 1,
      teamId: TEAM,
      workItem: work({ revision: 2, stage: 'running' }),
    }, 2)
    expect(project([configured, initial, skipped]).failure).toMatch(/invalid planned -> running transition/)

    const stale = event('crew/work-item', {
      version: 1,
      teamId: TEAM,
      workItem: work({ revision: 3, stage: 'queued' }),
    }, 2)
    expect(project([configured, initial, stale]).failure).toMatch(/revision is not contiguous/)
  })

  it('rejects duplicate notification delivery and preserves its stable message identity', () => {
    const queued: CrewNotificationSnapshot = {
      id: CrewNotificationId('notification-1'),
      revision: 1,
      sourceEventSeqs: [SessionSeq(7)],
      content: 'Module A needs manager action.',
      status: 'queued',
      deliveryMessageId: 'message-1' as never,
    }
    const delivered = { ...queued, revision: 2, status: 'delivered' as const }
    const duplicate = { ...delivered, revision: 3 }
    const state = project([
      configured,
      event('crew/notification', { version: 1, teamId: TEAM, notification: queued }, 1),
      event('crew/notification', { version: 1, teamId: TEAM, notification: delivered }, 2),
      event('crew/notification', { version: 1, teamId: TEAM, notification: duplicate }, 3),
    ])
    expect(state.failure).toMatch(/invalid delivery transition/)
  })

  it('rejects missing evidence links and malformed current payloads', () => {
    const missing = work({
      revision: 2,
      stage: 'queued',
      latestReportId: CrewReportId('missing-report'),
    })
    expect(project([
      configured,
      event('crew/work-item', { version: 1, teamId: TEAM, workItem: work() }, 1),
      event('crew/work-item', { version: 1, teamId: TEAM, workItem: missing }, 2),
    ]).failure).toMatch(/references a missing report/)

    const malformed = {
      ...configured,
      data: { version: 1, teamId: TEAM, configuration: { ...configuration(), unexpected: true } },
    } as unknown as SessionEvent
    expect(project([malformed]).failure).toMatch(/payload is invalid/)
  })

  it('ignores another Team and records unsupported local generations', () => {
    const inherited = event('crew/configuration', {
      version: 1,
      teamId: TeamId('ancestor'),
      configuration: configuration(),
    }, 0)
    expect(project([inherited]).configuration).toBeUndefined()
    const unsupported = event('crew/configuration', {
      version: 2 as 1,
      teamId: TEAM,
      configuration: configuration(),
    }, 0)
    expect(project([unsupported]).failure).toMatch(/unsupported Crew event version 2/)
  })

  it('keeps branded evidence constructors available without accepting orphan records', () => {
    expect(CrewReportId('r')).toBe('r')
    expect(CrewVerificationId('v')).toBe('v')
    expect(CrewReviewId('q')).toBe('q')
    expect(CrewIntegrationId('i')).toBe('i')
  })
})

describe('Crew path and command contract', () => {
  it('rejects declared deadlines that Node would clamp to one millisecond', () => {
    const command = { id: 'unit', argv: ['node', '--test'], cwd: 'project', timeoutMs: MAX_TIMER_DELAY_MS }
    expect(crewCommand(command, new Set(['node']))).toEqual(command)
    expect(() => crewCommand({ ...command, timeoutMs: MAX_TIMER_DELAY_MS + 1 }, new Set(['node'])))
      .toThrow(/timeoutMs/)
  })

  it.each(['notificationBatchWindowMs', 'workerTurnTimeoutMs', 'processGraceMs', 'gitTimeoutMs'] as const)(
    'rejects overflowing %s at deployment and replay', (field) => {
      const executionField = field !== 'notificationBatchWindowMs' && field !== 'workerTurnTimeoutMs'
      const invalid = MAX_TIMER_DELAY_MS + 1
      const candidate = executionField ? { execution: { [field]: invalid } } : { [field]: invalid }
      expect(() => CrewService.Config(candidate)).toThrow()
      const previous = configuration()
      const persisted = executionField
        ? { ...previous, execution: { ...previous.execution, [field]: invalid } }
        : { ...previous, [field]: invalid }
      expect(project([event('crew/configuration', { version: 1, teamId: TEAM, configuration: persisted }, 0)]).failure)
        .toMatch(/payload is invalid/)
    },
  )

  it('rejects a replayed work item whose command deadline exceeds the timer range', () => {
    const initial = work()
    const invalid = { ...initial, testCommands: initial.testCommands.map(command => ({ ...command, timeoutMs: MAX_TIMER_DELAY_MS + 1 })) }
    expect(project([configured, event('crew/work-item', { version: 1, teamId: TEAM, workItem: invalid }, 1)]).failure)
      .toMatch(/payload is invalid/)
  })

  it('normalizes component paths and rejects escape or protected metadata', () => {
    expect(repositoryPath('packages\\module-a\\src', 'scope')).toBe('packages/module-a/src')
    for (const value of [
      '../module-a',
      'packages/../module-a',
      '/absolute',
      'C:/absolute',
      '.git/config',
      'nested/.git/config',
      '.env',
      'fixtures/.env',
    ]) {
      expect(() => repositoryPath(value, 'scope')).toThrow(/scope/)
    }
  })

  it('compares scopes on components rather than string prefixes', () => {
    expect(crewScopesOverlap('packages/a', 'packages/a/src')).toBe(true)
    expect(crewScopesOverlap('packages/a', 'packages/ab')).toBe(false)
    expect(pathInCrewScope('packages/a/src/index.ts', 'packages/a')).toBe(true)
    expect(pathInCrewScope('packages/ab/index.ts', 'packages/a')).toBe(false)
  })

  it('rejects Windows path aliases and protected credential variants', () => {
    for (const value of [
      '.git./config',
      'module/.git /config',
      'module/file:stream',
      'module/NUL.txt',
      'C:relative',
      'module/source. /file.js',
      'module/.env.local',
      'module/.ENV.production',
      'module/file\u0000.js',
    ]) {
      expect(() => repositoryPath(value, 'scope'), value).toThrow(/scope/)
    }
  })

  it('uses Windows filename case rules for scope collisions and authorization', () => {
    const aliases = process.platform === 'win32'
    expect(crewScopesOverlap('packages/module', 'PACKAGES/MODULE/src')).toBe(aliases)
    expect(pathInCrewScope('PACKAGES/MODULE/src/index.js', 'packages/module')).toBe(aliases)
    expect(crewScopesOverlap('packages/module', 'PACKAGES/MODULES')).toBe(false)
  })

  it('accepts exact argv tests and rejects dependency mutation or unknown programs', () => {
    const allowed = new Set(['pnpm', 'node'])
    expect(crewCommand({ id: 'unit', argv: ['pnpm', 'run', 'test'], cwd: 'packages/a', timeoutMs: 1000 }, allowed))
      .toEqual({ id: 'unit', argv: ['pnpm', 'run', 'test'], cwd: 'packages/a', timeoutMs: 1000 })
    expect(() => crewCommand({ id: 'install', argv: ['pnpm', 'install'], cwd: 'packages/a', timeoutMs: 1000 }, allowed))
      .toThrow(/dependency mutation/)
    expect(() => crewCommand({ id: 'shell', argv: ['powershell', '-c', 'x'], cwd: 'packages/a', timeoutMs: 1000 }, allowed))
      .toThrow(/not allowed/)
  })

  it('parses staged, unstaged, untracked, and renamed porcelain records', () => {
    expect(parsePorcelain([
      'M  packages/a/staged.ts',
      ' M packages/a/unstaged.ts',
      '?? packages/a/new.ts',
      'R  packages/a/to.ts',
      'packages/a/from.ts',
      '',
    ].join('\0'))).toEqual({
      changedPaths: [
        'packages/a/from.ts',
        'packages/a/new.ts',
        'packages/a/staged.ts',
        'packages/a/to.ts',
        'packages/a/unstaged.ts',
      ],
      stagedPaths: ['packages/a/from.ts', 'packages/a/staged.ts', 'packages/a/to.ts'],
    })
  })

  it.each(['?? unfinished', 'R  target\0', 'bad\0'])(
    'refuses incomplete or malformed Git records: %j',
    (output) => { expect(() => parsePorcelain(output)).toThrow(/Git status returned/u) },
  )

  it.each([' input.txt', 'input.txt ', 'first\\second.txt'])(
    'rejects Git path spelling instead of treating it as another file: %j',
    (path) => { expect(() => parsePorcelain(`?? ${path}\0`)).toThrow(/Git status returned/u) },
  )

  it.each(['/absolute', 'C:/absolute', '../input.txt', 'first/../input.txt', './input.txt', 'first//input.txt'])(
    'rejects invalid Git path components: %j',
    (path) => { expect(() => parsePorcelain(`?? ${path}\0`)).toThrow(/Git status returned/u) },
  )

  it('keeps an unstaged rename out of the staged path set', () => {
    expect(parsePorcelain(' R target\0source\0')).toEqual({ changedPaths: ['source', 'target'], stagedPaths: [] })
  })
})
