/** Host-only Crew operations that must not be exposed as ordinary service methods. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CrewCommitSnapshot, CommitCrewRequest } from './types.ts'
import type CrewService from './index.ts'

/** Process-stable key for a commit call already admitted by the tool approval pipeline. */
export const approvedCrewCommit = Symbol.for('dsh.crew.approvedCommit')

/** Runtime face available only to the Crew commit Consumer. */
export interface ApprovedCrewCommitter {
  [approvedCrewCommit](caller: Agent, request: CommitCrewRequest): Promise<CrewCommitSnapshot>
}

/**
 * Execute one commit that has already passed the generic user-approval decision.
 * @param service - Crew service instance holding the host-only commit capability.
 * @param caller - Exact live Crew manager Agent.
 * @param request - Approved commit request and cancellation signal.
 * @returns Durable terminal commit record.
 */
export function executeApprovedCrewCommit(
  service: CrewService,
  caller: Agent,
  request: CommitCrewRequest,
): Promise<CrewCommitSnapshot> {
  return (service as unknown as ApprovedCrewCommitter)[approvedCrewCommit](caller, request)
}
