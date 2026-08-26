// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  MarketplaceEntry,
  MarketplaceInstallReceipt,
  MarketplaceSearchResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject } from '../src/client/index.ts'
import { MarketplaceTab, type MarketplaceInjected } from '../src/client/MarketplaceTab.tsx'

usePinnedBrowserLanguages('zh-CN')
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

type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  const search = vi.fn<() => Promise<RemoteResult<MarketplaceSearchResult>>>()
    .mockResolvedValue({ ok: true, value: { entries: [entry], rateLimitRemaining: 8 } })
  const install = vi.fn<() => Promise<RemoteResult<MarketplaceInstallReceipt>>>()
    .mockResolvedValue({ ok: true, value: {
      repository: entry.repository,
      packageName: entry.packageName,
      restartRequired: true,
    } })
  ctx.provide('remote.pluginMarketplace', { search, add: install })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, search, install }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-plugin-marketplace browser plugin', () => {
  it('declares only the services used by the Settings Remote contribution', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.pluginMarketplace'])
  })

  it('registers a localized tab and delegates to the generated Remote', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const slot = b.slots.entries('settings.plugins.tab')[0]!
    expect(slot.component).toBe(MarketplaceTab)
    expect(slot.options).toMatchObject({ id: 'marketplace', order: 5 })
    expect(resolveSlotLabel(slot.options.label)).toBe('插件市场')
    const injected = (slot.inject as unknown as () => MarketplaceInjected)()
    await expect(injected.search('balance')).resolves.toMatchObject({ entries: [entry] })
    await expect(injected.install(entry)).resolves.toMatchObject({ restartRequired: true })
    expect(b.search).toHaveBeenCalledWith({ query: 'balance' })
    expect(b.install).toHaveBeenCalledWith({ repository: entry.repository })

    b.search.mockResolvedValueOnce({ ok: false, error: { code: 'RATE_LIMITED', message: 'slow down' } })
    await expect(injected.search('balance')).rejects.toThrow('RATE_LIMITED: slow down')
    await b.ctx.fiber.dispose()
  })

  it('follows late declaration, locale changes, redeclaration, and teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(1) })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.plugins.tab')[0]!.options.label)).toBe('Plugin market')

    stop()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')[0]?.component).toBe(MarketplaceTab)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })
})
