/** Durable linkage between a DSH Session and the official CLI's conversation. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { MessageId, Message } from '@deepseek-ai/dsh-llm'
import type { SessionId as DshSessionId } from '@deepseek-ai/dsh-session/types'
import type { ClaudeQuotaSnapshot } from './engine-account.ts'
import type { ClaudeUsageSnapshot } from './engine-usage-types.ts'

/** Native CLI-issued or caller-allocated UUID identifying a Claude conversation. */
export type ClaudeSessionId = Branded<'ClaudeSessionId'>

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** CLI initialization confirmed this persistent conversation for the owning DSH Session. */
    'claude-code/binding': {
      readonly sessionId: ClaudeSessionId
      readonly ownerSessionId: DshSessionId
      readonly cliVersion: string
      readonly configDir: string | null
    }
    /** Exact DSH messages serialized for one CLI input; image bytes remain in immutable attachments. */
    'claude-code/prompt': {
      readonly sessionId: ClaudeSessionId
      readonly messages: readonly Message[]
      readonly bootstrap: boolean
    }
    /** Inputs admitted by the initialized CLI, preventing resends during subsequent turns. */
    'claude-code/input': {
      readonly sessionId: ClaudeSessionId
      readonly messageIds: readonly MessageId[]
    }
    /** Completed DSH history known to match the native conversation before another input. */
    'claude-code/checkpoint': {
      readonly sessionId: ClaudeSessionId
      readonly messageIds: readonly MessageId[]
    }
    /** Latest observed account windows, independent of conversation token counts. */
    'claude-code/quota': ClaudeQuotaSnapshot
    /** Latest native prompt counters and model capacity; repeated samples replace rather than add. */
    'claude-code/usage': ClaudeUsageSnapshot
  }
}
