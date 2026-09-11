/** Persisted native inputs and continuation checkpoints. */
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId as DshSessionId } from '@deepseek-ai/dsh-session/types'
import type { CliProvider, CliConversationId, CliUsage } from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Exact CLI input and schema, committed before the process starts. */
    'cli-agent/prompt': { readonly provider: CliProvider; readonly prompt: string; readonly schema: string; readonly bootstrap: boolean }
    /** Completed native input whose history can be reused by the same DSH owner. */
    'cli-agent/checkpoint': {
      readonly provider: CliProvider
      readonly conversationId: CliConversationId
      readonly ownerSessionId: DshSessionId
      readonly signature: string
      readonly messageIds: readonly MessageId[]
      readonly nativeUsage: Readonly<Record<string, number>>
    }
    /** Latest native invocation counters, separate from subscription quota. */
    'cli-agent/usage': CliUsage
  }
}
