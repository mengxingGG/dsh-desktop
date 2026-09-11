/** Native accounting fixtures; no account or model requests are made. */
import { describe, expect, it } from 'vitest'
import { codexModelPage, codexModels, codexQuota, codexUsage } from '../src/codex-protocol.ts'

describe('Codex account observations', () => {
  it('keeps separate quota pools and unavailable reset times', () => {
    expect(codexQuota({ rateLimits: { primary: { usedPercent: 99 } }, rateLimitsByLimitId: {
      main: { secondary: { usedPercent: 60, windowDurationMins: 10080, resetsAt: 1789470988 } },
      spark: { limitName: 'Spark', primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: null } },
    } })).toEqual([
      { pool: 'main', window: '10080 min', usedPercent: 60, resetsAt: 1789470988000 },
      { pool: 'Spark', window: '300 min', usedPercent: 0, resetsAt: null },
    ])
    expect(codexQuota({ rateLimits: null, rateLimitsByLimitId: null })).toBeNull()
    expect(() => codexQuota({ rateLimits: { primary: { usedPercent: -1 } } })).toThrow()
  })
  it('preserves native model effort choices and pagination', () => {
    const page = codexModelPage.parse({ nextCursor: 'next', data: [{ model: 'native-model', displayName: 'Native model',
      supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'ultra' }], defaultReasoningEffort: 'medium' }] })
    expect(page.nextCursor).toBe('next')
    expect(codexModels(page)[0]).toMatchObject({ provider: 'codex-cli', id: 'native-model',
      reasoning: { defaultEffort: 'medium', efforts: [{ id: 'medium' }, { id: 'ultra' }] } })
    expect(() => codexModelPage.parse({ data: [{ displayName: 'Missing id' }] })).toThrow()
  })
  it('separates invocation deltas from the latest context', () => {
    const sample = codexUsage('native-model', {
      total: { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 700, totalTokens: 1200 },
      last: { inputTokens: 400, outputTokens: 50, cachedInputTokens: 300, totalTokens: 450 }, modelContextWindow: 10000,
    }, { inputTokens: 600, outputTokens: 150, cachedInputTokens: 400, totalTokens: 750 })
    expect(sample.usage).toMatchObject({ inputTokens: 400, outputTokens: 50, cacheReadTokens: 300, cacheWriteTokens: null,
      contextTokens: 450, contextWindow: 10000, costUsd: null })
    expect(sample.counters.totalTokens).toBe(1200)
    expect(codexUsage('native-model', null, sample.counters)).toMatchObject({ counters: sample.counters,
      usage: { inputTokens: null, contextTokens: null, contextWindow: null } })
  })
})
