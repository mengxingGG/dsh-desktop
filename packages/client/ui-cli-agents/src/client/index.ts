/** Settings and composer slots for native Grok and Antigravity accounts. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AccountSection, UsageBar, type CliApi } from './views.tsx'
import { en, zh } from './locales.ts'
/** Native login terminal observation cadence. */
export interface Config {
  /** Interval between cached login status reads. */
  loginPollMs: number
}
export const Config: z<Config> = z.object({ loginPollMs: z.number().min(250).default(1000) })
export const inject = ['slots', 'locale', 'remote', 'remote.cliAgents']
/**
 * Mount native account controls without automatic login or quota queries.
 * @param ctx - Browser slots, locale and generated Remote client.
 * @param config - Validated login observation cadence.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.locale.register('cliAgents', { en, zh }), 'ui-cli-agents: locale')
  const api: CliApi = ctx.remote.cliAgents
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'cli-agents', order: 25, label: () => ctx.locale.bind('cliAgents')('title'),
    locale: 'cliAgents', inject: () => ({ api, loginPollMs: config.loginPollMs }),
  }, AccountSection))
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock', id: 'cli-usage', order: 41, locale: 'cliAgents', inject: () => ({ api }),
  }, UsageBar))
}
