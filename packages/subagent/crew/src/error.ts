/** Stable Crew rejection with a machine-routable code. */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Public Crew failure codes returned by service and Remote operations. */
export type CrewErrorCode =
  | 'CREW_INVALID_CONFIG'
  | 'CREW_NOT_CONFIGURED'
  | 'CREW_ALREADY_CONFIGURED'
  | 'CREW_LEAD_REQUIRED'
  | 'CREW_WORK_ITEM_NOT_FOUND'
  | 'CREW_WORK_ITEM_EXISTS'
  | 'CREW_STALE_REVISION'
  | 'CREW_INVALID_TRANSITION'
  | 'CREW_TEAM_TASK_MISMATCH'
  | 'CREW_SCOPE_OVERLAP'
  | 'CREW_INVALID_PATH'
  | 'CREW_INVALID_COMMAND'
  | 'CREW_HOST_FAILURE'
  | 'CREW_CHECKOUT_DRIFT'
  | 'CREW_COMMIT_REJECTED'
  | 'CREW_EVIDENCE_NOT_FOUND'
  | 'CREW_EVIDENCE_EXISTS'
  | 'CREW_NOTIFICATION_CONFLICT'
  | 'CREW_UNAUTHORIZED_WORKER'
  | 'CREW_DISPOSED'

/** Error type used for expected Crew-domain rejection. */
export class CrewError extends HarnessError {
  override readonly code: CrewErrorCode

  /**
   * @param message - Human-readable rejection detail.
   * @param code - Stable Crew failure code.
   * @param options - Optional chained cause.
   */
  constructor(message: string, code: CrewErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}
