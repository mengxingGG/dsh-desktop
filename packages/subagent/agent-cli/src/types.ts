/** Browser-safe native CLI account and usage observations. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-session-projection/types'

/** Native execution routes exposed to main Agents and Crew roles. */
export type CliProvider = 'grok-cli' | 'antigravity-cli' | 'codex-cli'
/** Native conversation identity scoped by provider and DSH owner. */
export type CliConversationId = Branded<'CliConversationId'>
/** User-initiated native terminal login identity. */
export type CliLoginId = Branded<'CliLoginId'>
/** Bounded terminal output; input is never retained by this service. */
export interface CliLoginSnapshot {
  readonly id: CliLoginId
  readonly provider: CliProvider
  readonly status: 'running' | 'completed' | 'cancelled' | 'failed'
  readonly output: string
  readonly truncated: boolean
  readonly error: string | null
}
/** Account quota window, using used percentages and epoch milliseconds. */
export interface CliQuotaWindow {
  readonly pool: string
  readonly window: string
  readonly usedPercent: number
  readonly resetsAt: number | null
}
/** Public account observations without credentials. */
export interface CliAccountStatus {
  readonly provider: CliProvider
  readonly installed: boolean
  readonly authenticated: boolean | null
  readonly modelCount: number
  readonly error: string | null
  readonly quota: readonly CliQuotaWindow[] | null
  readonly quotaObservedAt: number | null
  readonly login: CliLoginSnapshot | null
}
/** Native usage for the latest invocation; unknown capacity is not estimated. */
export interface CliUsage {
  readonly provider: CliProvider
  readonly model: string
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly cacheReadTokens: number | null
  readonly cacheWriteTokens: number | null
  readonly contextTokens: number | null
  readonly contextWindow: number | null
  readonly costUsd: number | null
  readonly updatedAt: number
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap { cliUsage: CliUsage | null }
  interface SessionProjectionStateMap { cliUsage: CliUsage | null }
}
