// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AccountSection, type AccountSectionProps } from '../src/client/AccountSection.tsx'
import type { AccountSnapshot } from '../src/client/controller.ts'
import { zh, type ClaudeCodeKey } from '../src/client/locales.ts'

afterEach(cleanup)

function props(snapshot: AccountSnapshot): AccountSectionProps {
  return { t: key => zh[key as ClaudeCodeKey], useAccount: selector => selector(snapshot),
    load: vi.fn(), refresh: vi.fn(), refreshQuota: vi.fn(), startLogin: vi.fn(), cancelLogin: vi.fn(), submitCode: vi.fn() }
}

describe('Claude account settings presentation', () => {
  it('shows real percentages and preserves unknown reset times', () => {
    const p = props({ busy: false, error: null, value: {
      account: { loggedIn: true, email: 'test@example.test', provider: 'firstParty', method: 'claude.ai' }, login: null,
      quota: { status: 'allowed', windows: { five_hour: { usedPercent: 17, resetsAt: null, updatedAt: 100 } }, usingOverage: null, updatedAt: 100 },
    } })
    render(<AccountSection {...p} />)
    expect(screen.getByText('已用: 17%')).toBeDefined()
    expect(screen.getByText('重置时间: 未知')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '刷新额度' }))
    expect(p.refreshQuota).toHaveBeenCalledOnce()
  })

  it('shows no fabricated zero quota while account data is unavailable', () => {
    const p = props({ busy: false, error: 'CLI unavailable', value: null })
    render(<AccountSection {...p} />)
    expect(screen.getByRole('alert').textContent).toBe('CLI unavailable')
    expect(screen.queryByRole('progressbar')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(p.startLogin).toHaveBeenCalledOnce()
  })
})
