/** Settings and composer slots for native Claude account and request observations. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { AccountSection } from './AccountSection.tsx'
import { ClaudeAccountController } from './controller.ts'
import { UsageBar } from './UsageBar.tsx'
import { NS, en, zh } from './locales.ts'

/** Browser login and account observation polling intervals. */
export interface Config {
  /** Native login progress polling interval. */
  loginPollMs: number
  /** Account quota refresh interval while a Claude conversation is visible. */
  quotaRefreshMs: number
}
export const Config: z<Config> = z.object({
  loginPollMs: z.number().min(250).default(1000), quotaRefreshMs: z.number().min(10_000).default(60_000),
})
export const inject = ['slots', 'locale', 'remote', 'remote.claudeCode']

function value<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/**
 * Register the account settings and stop polling with the owning plugin.
 * @param ctx - declared browser services for slots, locale and Remote operations.
 * @param config - validated polling cadence.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ui-claude-code: locale')
  const controller = new ClaudeAccountController({
    status: async () => value(await ctx.remote.claudeCode.status()),
    quota: async () => value(await ctx.remote.claudeCode.refreshQuota()),
    start: async () => value(await ctx.remote.claudeCode.startLogin()),
    poll: async () => value(await ctx.remote.claudeCode.loginStatus()),
    input: async (id, code) => { value(await ctx.remote.claudeCode.loginInput(id, code)) },
    cancel: async (id) => { value(await ctx.remote.claudeCode.cancelLogin(id)) },
  }, config.loginPollMs)
  ctx.effect(() => () =>{  controller.dispose() }, 'ui-claude-code: account lifetime')
  ctx.on('connection/reset', () =>{  controller.refresh() })
  const face = controller.inject()
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'claude-code', order: 24, label: () => ctx.locale.bind(NS)('title'), locale: NS, inject: () => face,
  }, AccountSection))
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock', id: 'claude-usage', order: 40, locale: NS,
    inject: () => ({ ...face, quotaRefreshMs: config.quotaRefreshMs }),
  }, UsageBar))
}
