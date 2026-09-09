/** Browser-safe measurements of the most recent native Claude model request. */

import type {} from '@deepseek-ai/dsh-session-projection/types'

/** Native prompt counters, not cumulative conversation billing or a token estimate. */
export interface ClaudeUsageSnapshot {
  /** Native model identifier associated with these counters. */
  readonly model: string
  /** Latest request input excluding cached tokens; null means unreported. */
  readonly inputTokens: number | null
  /** Output from the latest native message, without summing repeated SDK blocks. */
  readonly outputTokens: number | null
  /** Input tokens read from the native prompt cache. */
  readonly cacheReadTokens: number | null
  /** Input tokens written to the native prompt cache. */
  readonly cacheWriteTokens: number | null
  /** Uncached input plus cache reads and writes; null until all are reported. */
  readonly contextTokens: number | null
  /** Native model capacity, unknown until supplied by a result. */
  readonly contextWindow: number | null
  /** Unix epoch milliseconds at the latest observation. */
  readonly updatedAt: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    claudeUsage: ClaudeUsageSnapshot | null
  }
  interface SessionProjectionStateMap {
    claudeUsage: ClaudeUsageSnapshot | null
  }
}
