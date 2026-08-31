/** GitHub plugin marketplace registered into Web Settings. */

import type { MarketplaceEntry } from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { MarketplaceTab, type MarketplaceInjected } from './MarketplaceTab.tsx'
import { en, zh, type MarketplaceLocaleKey } from './locales.ts'

export type { MarketplaceInjected, MarketplaceProps } from './MarketplaceTab.tsx'
export type { MarketplaceLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** GitHub plugin marketplace copy. */
    'settings.pluginMarketplace': MarketplaceLocaleKey
  }
}

const NS = 'settings.pluginMarketplace'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginMarketplace']

/** Contribute the marketplace tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-marketplace: dictionaries')
  const t = ctx.locale.bind(NS)
  const search: MarketplaceInjected['search'] = async (query) => {
    const result = await ctx.remote.pluginMarketplace.search({ query })
    if (!result.ok) {
      throw new Error(`pluginMarketplace.search failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const install: MarketplaceInjected['install'] = async (entry: MarketplaceEntry) => {
    const result = await ctx.remote.pluginMarketplace.add({ repository: entry.repository })
    if (!result.ok) {
      throw new Error(`pluginMarketplace.add failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const injected = (): MarketplaceInjected => ({
    search,
    install,
    confirm: entry => window.confirm(t('confirm', {
      packageName: entry.packageName,
      repository: entry.repository,
    })),
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'marketplace',
    order: 5,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, MarketplaceTab))
}
