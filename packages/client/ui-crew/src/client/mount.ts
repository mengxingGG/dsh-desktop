/** Crew projection, locale, header trigger, and typed details registrations. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-crew/client'
import type { CrewPreferencesValue } from '@deepseek-ai/dsh-crew/client'
import { CrewAction, type CrewActionInjected } from './CrewAction.tsx'
import { CrewDetailsView } from './CrewDetailsView.tsx'
import { CrewActivityController } from './activity.ts'
import { CrewSettings } from './CrewSettings.tsx'
import { CrewSettingsController, PREFERENCES_NAMESPACE } from './preferences.ts'
import { en, NS, zh, type CrewKey } from './locales.ts'
import type { CrewDetailsSelection } from './selection.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Manager-only native Crew project and evidence copy. */
    crew: CrewKey
  }
}

/** Required browser services for locale, slots, and typed details selection. */
export const inject = ['slots', 'locale', 'chatDetails', 'settingsScope', 'remote', 'remote.session', 'sessions', 'uiConversation']

/** Register the manager Crew trigger and details-chain branch. */
export function apply(ctx: ClientContext): void {
  const activities = new Map<import('@deepseek-ai/dsh-session/types').SessionId, CrewActivityController>()
  ctx.effect(() => () => {
    for (const activity of activities.values()) activity.dispose()
    activities.clear()
  }, 'client-ui-crew: worker observations')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-crew: dictionaries')
  const preferences = new CrewSettingsController(
    ctx.settingsScope.bind<CrewPreferencesValue>({ namespace: PREFERENCES_NAMESPACE }),
    async () => {
      const result = await ctx.remote.session.modelCatalog()
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
  )
  const settingsFace = preferences.inject()
  ctx.effect(() => {
    const refresh = () => { preferences.refresh() }
    const stops = [
      ctx.remote.$on('settings/document-updated', refresh),
      ctx.remote.$on('credentials/reference-updated', refresh),
      ctx.remote.$on('llm/adapters-updated', refresh),
      ctx.on('connection/reset', refresh),
    ]
    return () => { preferences.dispose(); for (const stop of stops) stop() }
  }, 'client-ui-crew: global settings lifecycle')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'crew',
    order: 25,
    label: () => ctx.locale.bind(NS)('settingsTitle'),
    locale: NS,
    inject: () => settingsFace,
  }, CrewSettings))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'crew',
    order: 15,
    locale: NS,
    inject: (sessionId): CrewActionInjected => ({
      openCrew: (selection: CrewDetailsSelection) => { ctx.chatDetails.open(sessionId, selection) },
    }),
  }, CrewAction))
  ctx.slots.inject('conversation.details.view', () => ctx.slots.register({
    name: 'conversation.details.view',
    select: owner => owner.selection.kind === 'crew' ? owner.selection : null,
    locale: NS,
    inject: (sessionId) => {
      let controller = activities.get(sessionId)
      if (controller === undefined) {
        controller = new CrewActivityController(ctx.sessions, ctx.uiConversation, sessionId)
        activities.set(sessionId, controller)
        const owned = controller
        const binding = ctx.sessions.binding(sessionId)
        if (binding === undefined) throw new Error('Crew details manager Session is unavailable')
        binding.ctx.effect(() => () => {
          owned.dispose()
          activities.delete(sessionId)
        }, 'client-ui-crew: manager activity lifetime')
      }
      return controller.inject()
    },
  }, CrewDetailsView))
}
