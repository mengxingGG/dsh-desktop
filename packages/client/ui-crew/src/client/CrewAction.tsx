/** Manager header entry that opens the shared Crew details view. */

import { AnimatedIcon } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CrewProjectionView } from '@deepseek-ai/dsh-crew/client'
import { NS } from './locales.ts'
import type { CrewDetailsSelection } from './selection.ts'
import css from './CrewPanel.module.css'

/** Business action injected into the Crew header entry. */
export interface CrewActionInjected {
  openCrew: (selection: CrewDetailsSelection) => void
}

/** Full props of the manager Crew header action. */
export type CrewActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & CrewActionInjected
  & PropsLocale<typeof NS>

function activeCount(projection: CrewProjectionView | undefined): number {
  if (projection === undefined) return 0
  return projection.workItems.filter(item => ['queued', 'running', 'reviewing'].includes(item.stage)).length
    + projection.integrations.filter(item => item.status === 'running' && item.execution !== 'manager').length
}

/** Render the manager-only Crew trigger with a live active-worker count. */
export function CrewAction({ useProjection, useSession, openCrew, t }: CrewActionProps) {
  const manager = useSession(snapshot => snapshot.subagent === null)
  const projection = useProjection('crew')
  if (!manager) return null
  const count = activeCount(projection)
  return (
    <button
      type="button"
      className={css.trigger}
      aria-label={t('open')}
      onClick={() => { openCrew({ kind: 'crew' }) }}
    >
      <AnimatedIcon name={count > 0 ? 'working' : 'team'} size={16} />
      <span>{t('trigger')}</span>
      {count > 0 && <span className={css.count} aria-label={String(count)}>{count}</span>}
    </button>
  )
}
