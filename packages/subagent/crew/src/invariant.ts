/** Native Crew cross-domain runtime invariant companion. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  isTeamEvent,
  teamProjectionDefinition,
  type TeamProjectionState,
} from '@deepseek-ai/dsh-agent-team/projection'
import { crewProjectionDefinition, isCrewEvent } from './projection.ts'
import type { CrewProjectionState, CrewStage, CrewWorkItemSnapshot } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-crew'

/** Cordis companion plugin name. */
export const name = 'crew-invariant'
/** Invariant registry required by the companion. */
export const inject = ['invariants']

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function allowedTeamStatuses(stage: CrewStage): readonly string[] {
  switch (stage) {
    case 'planned': return ['pending']
    case 'queued': return ['pending', 'in_progress']
    case 'running':
    case 'revision_required': return ['in_progress']
    case 'verifying': return ['pending', 'in_progress', 'completed']
    case 'reviewing': return ['in_progress', 'completed']
    case 'integration_ready':
    case 'accepted': return ['completed']
    case 'paused':
    case 'failed':
    case 'cancelled': return ['pending', 'in_progress', 'completed']
  }
}

function workerIdentityFailure(
  team: TeamProjectionState,
  work: CrewWorkItemSnapshot,
  role: 'developer' | 'reviewer',
): string | undefined {
  const id = role === 'developer' ? work.developerSessionId : work.reviewerSessionId
  const expectedName = role === 'developer' ? work.developerName : work.reviewerName
  if (id === undefined) return undefined
  if (!work.workerSessionIds.includes(id)) {
    return `Crew ${role} Session "${id}" is absent from work-item history`
  }
  const member = team.members.find(candidate => candidate.id === id)
  if (member === undefined) return undefined
  if (member.name !== expectedName) {
    return `Crew ${role} Session "${id}" does not match Team member name`
  }
  if (member.phase === 'failed' && !['failed', 'paused', 'cancelled', 'verifying', 'integration_ready', 'accepted'].includes(work.stage)) {
    return `Crew ${role} Session "${id}" failed while work item is ${work.stage}`
  }
  return undefined
}

function workFailure(team: TeamProjectionState, work: CrewWorkItemSnapshot): string | undefined {
  const task = team.tasks.find(candidate => candidate.id === work.taskId)
  if (task === undefined) return `Crew work item "${work.taskId}" has no Team task`
  if (!sameValues(task.writeScopes, work.writeScopes)) {
    return `Crew work item "${work.taskId}" write scopes differ from its Team task`
  }
  if (!allowedTeamStatuses(work.stage).includes(task.status)) {
    return `Crew work item "${work.taskId}" stage ${work.stage} conflicts with Team status ${task.status}`
  }
  const developerFailure = workerIdentityFailure(team, work, 'developer')
  if (developerFailure !== undefined) return developerFailure
  const reviewerFailure = workerIdentityFailure(team, work, 'reviewer')
  if (reviewerFailure !== undefined) return reviewerFailure
  if (work.stage === 'running' && task.ownerId !== work.developerSessionId) {
    return `Crew running work item "${work.taskId}" is not owned by its developer Team member`
  }
  return undefined
}

function crossDomainFailure(crew: CrewProjectionState, team: TeamProjectionState): string | undefined {
  if (crew.failure !== undefined) return crew.failure
  if (team.failure !== undefined) return `Agent Teams projection failed: ${team.failure}`
  if (crew.id !== team.id) return 'Crew and Agent Teams identities differ'
  for (const work of crew.workItems) {
    const failure = workFailure(team, work)
    if (failure !== undefined) return failure
  }
  return undefined
}

/** Reject invalid Crew events and cross-domain Team/Crew combinations before publication. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (!isCrewEvent(event) && !isTeamEvent(event)) return
    let crew = structuredClone(ctx.sessionProjections.stateOf(session, 'crew') as CrewProjectionState)
    let team = structuredClone(ctx.sessionProjections.stateOf(session, 'agentTeam') as TeamProjectionState)
    if (isCrewEvent(event)) crew = crewProjectionDefinition.apply(crew, event)
    if (isTeamEvent(event)) team = teamProjectionDefinition.apply(team, event)
    const failure = crossDomainFailure(crew, team)
    if (failure !== undefined) fail(`session event ${event.seq} violates the Crew stream: ${failure}`)
  }, { global: true })
}, { inject: ['sessionProjections'] })

/** Register the Crew invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
