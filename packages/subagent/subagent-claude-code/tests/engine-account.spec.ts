import { describe, expect, it } from 'vitest'
import { foldClaudeQuota, parseClaudeAccount, parseClaudeUsage } from '../src/engine-account.ts'

describe('Claude public account observations', () => {
  it('reads usage control percentages without multiplying them and excludes monetary balances', () => {
    const quota = parseClaudeUsage({ rate_limits_available: true, rate_limits: {
      five_hour: { utilization: 17, resets_at: '2026-09-09T13:00:00Z' },
      seven_day: null, extra_usage: { is_enabled: true, used_credits: 123 },
      model_scoped: [{ display_name: 'Sonnet', utilization: null, resets_at: null }],
    } }, 100)
    expect(quota?.windows).toEqual({ five_hour: { usedPercent: 17, resetsAt: Date.parse('2026-09-09T13:00:00Z'), updatedAt: 100 },
      'model:Sonnet': { usedPercent: null, resetsAt: null, updatedAt: 100 } })
    expect(parseClaudeUsage({ rate_limits_available: false, rate_limits: null }, 100)).toBeNull()
    expect(() => parseClaudeUsage({ rate_limits_available: true, rate_limits: { five_hour: { utilization: 1, resets_at: 'bad' } } }, 100)).toThrow()
  })
  it('keeps credentials out of an authenticated display response', () => {
    expect(parseClaudeAccount(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai',
      apiProvider: 'firstParty', email: 'person@example.test', accessToken: 'must not escape' })))
      .toEqual({ loggedIn: true, method: 'claude.ai', provider: 'firstParty', email: 'person@example.test' })
    expect(() => parseClaudeAccount('unexpected output')).toThrow()
    expect(() => parseClaudeAccount('{"loggedIn":"false"}')).toThrow()
  })

  it('reads simultaneous windows from the observed native CLI event', () => {
    const snapshot = foldClaudeQuota({ status: 'allowed', rateLimitType: 'five_hour', isUsingOverage: false,
      unifiedWindows: { five_hour: { utilization: 0.01, resetsAt: 1788972600 },
        seven_day: { utilization: 0, resetsAt: 1789509600 } } }, null, 100)
    expect(snapshot.windows).toEqual({
      five_hour: { usedPercent: 1, resetsAt: 1788972600000, updatedAt: 100 },
      seven_day: { usedPercent: 0, resetsAt: 1789509600000, updatedAt: 100 },
    })
    expect(snapshot.usingOverage).toBe(false)
  })

  it('preserves stale window timestamps and represents absent utilization as unknown', () => {
    const first = foldClaudeQuota({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.5 }, null, 100)
    const second = foldClaudeQuota({ status: 'rejected', rateLimitType: 'seven_day', utilization: null }, first, 200)
    expect(second.windows.five_hour).toEqual({ usedPercent: 50, resetsAt: null, updatedAt: 100 })
    expect(second.windows.seven_day).toEqual({ usedPercent: null, resetsAt: null, updatedAt: 200 })
    expect(second.status).toBe('rejected')
    expect(() => foldClaudeQuota({ status: 'allowed', utilization: '0' }, second, 300)).toThrow()
  })
})
