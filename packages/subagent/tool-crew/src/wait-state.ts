/** Observable workflow states that determine whether a manager wait can finish. */

import type { CrewView } from '@deepseek-ai/dsh-crew'

interface CrewWaitState {
  readonly workItems: readonly Pick<CrewView['workItems'][number], 'stage'>[]
  readonly integrations: readonly Pick<CrewView['integrations'][number], 'status'>[]
}

/**
 * Determine whether the current workflow offers manager action.
 * @param view - Current durable work-item and integration states.
 * @param active - Whether a native worker is still running or provisioning.
 * @returns Whether the manager can intervene, integrate, or inspect a terminal integration.
 */
export function managerActionReady(view: CrewWaitState, active: boolean): boolean {
  if (view.workItems.some(item => item.stage === 'paused' || item.stage === 'failed')) return true
  if (view.integrations.some(item => item.status === 'running')) return false
  if (view.integrations.some(item => item.status !== 'running')) return true
  if (active) return false
  return view.workItems.length > 0 && view.workItems.every(item => (
    item.stage === 'integration_ready' || item.stage === 'accepted' || item.stage === 'cancelled'
  ))
}

/**
 * Determine whether a worker or host settlement still owes a workflow update.
 * @param view - Current durable work-item and integration states.
 * @returns Whether an idle worker roster can still make workflow progress.
 */
export function expectsSettlingEdge(view: CrewWaitState): boolean {
  return view.workItems.some(item => (
    item.stage === 'queued'
    || item.stage === 'running'
    || item.stage === 'verifying'
    || item.stage === 'reviewing'
    || item.stage === 'revision_required'
  )) || view.integrations.some(item => item.status === 'running')
}
