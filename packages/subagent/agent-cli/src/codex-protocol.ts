/** Native Codex account and token observations; no credential fields are projected. */
import { z } from 'zod'
import { ReasoningEffortId, type LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import type { CliQuotaWindow, CliUsage } from './types.ts'

const count = z.number().finite().nonnegative()
const window = z.object({ usedPercent: count, windowDurationMins: count.nullish(), resetsAt: count.nullish() })
const bucket = z.object({ limitId: z.string().nullish(), limitName: z.string().nullish(),
  primary: window.nullish(), secondary: window.nullish() })
const quotas = z.object({ rateLimits: bucket.nullish(), rateLimitsByLimitId: z.record(z.string(), bucket).nullish() })

/**
 * Project all native quota pools without treating missing windows as zero usage.
 * @param raw - account/rateLimits/read response.
 * @returns Windows in used-percent and millisecond units, or null if unavailable.
 */
export function codexQuota(raw: unknown): CliQuotaWindow[] | null {
  const value = quotas.parse(raw)
  const pools = value.rateLimitsByLimitId ?? (value.rateLimits ? { [value.rateLimits.limitId ?? 'codex']: value.rateLimits } : null)
  if (pools === null) return null
  const rows: CliQuotaWindow[] = []
  for (const [id, pool] of Object.entries(pools)) for (const key of ['primary', 'secondary'] as const) {
    const value = pool[key]
    if (!value) continue
    rows.push({ pool: pool.limitName ?? pool.limitId ?? id,
      window: value.windowDurationMins == null ? key : String(value.windowDurationMins) + ' min',
      usedPercent: Math.min(100, value.usedPercent), resetsAt: value.resetsAt == null ? null : value.resetsAt * 1000 })
  }
  return rows.length ? rows : null
}

/** Native model page including the cursor needed to discover later models. */
export const codexModelPage = z.object({ data: z.array(z.object({ model: z.string().min(1), displayName: z.string(),
  supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string().min(1) })), defaultReasoningEffort: z.string().min(1),
})), nextCursor: z.string().nullish() })

/**
 * Preserve native model identifiers and supported reasoning levels.
 * @param page - Validated native model page.
 * @returns Models for the Codex execution route.
 */
export function codexModels(page: z.infer<typeof codexModelPage>): LlmResolvedModelInfo[] {
  return page.data.map(model => ({ provider: 'codex-cli', id: model.model, name: model.displayName,
    reasoning: { efforts: model.supportedReasoningEfforts.map(effort => ({
      id: ReasoningEffortId(effort.reasoningEffort), name: effort.reasoningEffort,
    })),
    defaultEffort: ReasoningEffortId(model.defaultReasoningEffort) } }))
}

const breakdown = z.object({ inputTokens: count, outputTokens: count, cachedInputTokens: count,
  cacheWriteInputTokens: count.optional(), totalTokens: count })
/** Codex reports both cumulative thread counters and the latest request context. */
export const codexTokenUsage = z.object({ total: breakdown, last: breakdown, modelContextWindow: count.nullish() })

/**
 * Separate this native turn's tokens from the most recent model context.
 * @param model - Requested native model.
 * @param raw - Latest thread/tokenUsage/updated tokenUsage value.
 * @param previous - Completed counters from the same native thread.
 * @returns Persistable invocation and context observations, plus continuation counters.
 */
export function codexUsage(model: string, raw: unknown,
  previous: Readonly<Record<string, number>>): { usage: CliUsage; counters: Record<string, number> } {
  const native = raw == null ? null : codexTokenUsage.parse(raw)
  const counters: Record<string, number> = native
    ? Object.fromEntries(Object.entries(native.total).filter((entry): entry is [string, number] => entry[1] !== undefined))
    : { ...previous }
  const delta = (key: keyof z.infer<typeof breakdown>): number | null => {
    const current = native?.total[key]
    if (current === undefined) return null
    const difference = current - (previous[key] ?? 0)
    return difference < 0 ? null : difference
  }
  return { counters, usage: { provider: 'codex-cli', model, inputTokens: delta('inputTokens'), outputTokens: delta('outputTokens'),
    cacheReadTokens: delta('cachedInputTokens'), cacheWriteTokens: delta('cacheWriteInputTokens'),
    contextTokens: native?.last.totalTokens ?? null, contextWindow: native?.modelContextWindow ?? null,
    costUsd: null, updatedAt: Date.now() } }
}
