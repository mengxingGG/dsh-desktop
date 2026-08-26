// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MarketplaceEntry } from '@deepseek-ai/dsh-api-remotes/client'
import { MarketplaceTab, type MarketplaceInjected, type MarketplaceProps } from '../src/client/MarketplaceTab.tsx'
import { en, type MarketplaceLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const entry = {
  repository: 'crazywoola/dsh-balance',
  packageName: '@pinkbanana/dsh-balance',
  description: 'Balance bundle',
  htmlUrl: 'https://github.com/crazywoola/dsh-balance',
  defaultBranch: 'main',
  stars: 23,
  forks: 2,
  license: 'MIT',
  updatedAt: '2026-08-24T00:00:00Z',
} as MarketplaceEntry

const t = ((key: MarketplaceLocaleKey, params?: Record<string, string | number>) => {
  let value = en[key]
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replace(`{${name}}`, String(replacement))
  }
  return value
}) as MarketplaceProps['t']

function props(overrides: Partial<MarketplaceInjected> = {}): MarketplaceProps {
  return {
    t,
    search: vi.fn(async () => ({ entries: [entry], rateLimitRemaining: 9 })),
    install: vi.fn(async () => ({
      repository: entry.repository,
      packageName: entry.packageName,
      restartRequired: true,
    })),
    confirm: vi.fn(() => true),
    ...overrides,
  } as MarketplaceProps
}

describe('MarketplaceTab', () => {
  it('renders cards and expandable details', async () => {
    render(<MarketplaceTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'balance' }))
    expect(await screen.findByText('crazywoola/dsh-balance')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.details }))
    expect(screen.getByText('MIT')).toBeTruthy()
  })

  it('confirms installation and reports the required restart', async () => {
    const install = vi.fn<MarketplaceInjected['install']>().mockResolvedValue({
      repository: entry.repository,
      packageName: entry.packageName,
      restartRequired: true,
    })
    render(<MarketplaceTab {...props({ install })} />)
    fireEvent.click(screen.getByRole('button', { name: 'balance' }))
    await screen.findByText('crazywoola/dsh-balance')
    fireEvent.click(screen.getByRole('button', { name: en.install }))
    await waitFor(() => { expect(install).toHaveBeenCalledWith(entry) })
    expect((await screen.findByRole('status')).textContent).toContain(entry.packageName)
  })

  it('surfaces search and installation failures without dropping the cards', async () => {
    const search = vi.fn<MarketplaceInjected['search']>().mockRejectedValue(new Error('rate limited'))
    const view = render(<MarketplaceTab {...props({ search })} />)
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    expect((await screen.findByRole('alert')).textContent).toContain('rate limited')

    view.rerender(<MarketplaceTab {...props({
      install: vi.fn<MarketplaceInjected['install']>().mockRejectedValue(new Error('blocked script')),
    })} />)
    fireEvent.click(screen.getByRole('button', { name: 'balance' }))
    await screen.findByText('crazywoola/dsh-balance')
    fireEvent.click(screen.getByRole('button', { name: en.install }))
    expect((await screen.findByRole('alert')).textContent).toContain('blocked script')
  })
})
