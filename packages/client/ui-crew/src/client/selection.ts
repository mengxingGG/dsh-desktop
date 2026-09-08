/** Crew branch of Chat's typed right-column selection registry. */

import type { TeamTaskId } from '@deepseek-ai/dsh-agent-team/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'

/** Project overview or one selected work item in the manager details column. */
export interface CrewDetailsSelection {
  readonly kind: 'crew'
  readonly taskId?: TeamTaskId
  readonly workerSessionId?: SessionId
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface DetailsSelectionMap {
    /** Manager-only native Crew project and worker evidence. */
    crew: CrewDetailsSelection
  }
}
