/** Closed Crew workflow transition table shared by runtime and replay. */

import type { CrewStage } from './types.ts'

const TRANSITIONS = {
  planned: ['queued', 'cancelled'],
  queued: ['running', 'paused', 'failed', 'cancelled'],
  running: ['verifying', 'paused', 'failed', 'cancelled'],
  verifying: ['reviewing', 'revision_required', 'paused', 'failed', 'cancelled'],
  reviewing: ['integration_ready', 'revision_required', 'paused', 'failed', 'cancelled'],
  revision_required: ['running', 'paused', 'failed', 'cancelled'],
  integration_ready: ['accepted', 'revision_required', 'paused', 'failed', 'cancelled'],
  accepted: [],
  paused: ['queued', 'running', 'cancelled'],
  failed: ['queued', 'cancelled'],
  cancelled: [],
} as const satisfies Record<CrewStage, readonly CrewStage[]>

/**
 * Test whether the workflow admits an edge.
 * @param from - Current durable stage.
 * @param to - Proposed next durable stage.
 * @returns Whether the closed transition table contains the edge.
 */
export function canTransitionCrewStage(from: CrewStage, to: CrewStage): boolean {
  return (TRANSITIONS[from] as readonly CrewStage[]).includes(to)
}

/**
 * Return every stage reachable in one mutation.
 * @param stage - Current durable stage.
 * @returns Detached allowed successor list.
 */
export function crewStageSuccessors(stage: CrewStage): CrewStage[] {
  return [...TRANSITIONS[stage]]
}
