/** Typed right-column view router owned by Chat. */

import type { DetailsSlotProps } from '../contract/slots.ts'
import { ToolDetailsView } from './ToolDetailsView.tsx'
import css from './DetailsPanel.module.css'

export type DetailsPanelProps = DetailsSlotProps

function EmptyDetails({ closeDetails, t }: Pick<DetailsSlotProps, 'closeDetails' | 't'>) {
  return (
    <div className={css.root}>
      <div className={css.header}>
        <div className={css.title}>{t('details.title')}</div>
        <button type="button" className={css.close} aria-label={t('details.close')} onClick={closeDetails}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className={css.body}><div className={css.empty}>{t('details.empty')}</div></div>
    </div>
  )
}

/** Route the current typed selection through the details-view chain. */
export function DetailsPanel(props: DetailsPanelProps) {
  const { useStore, renderSlotChain, closeDetails, openDetails, t } = props
  const selection = useStore(state => state.selection)
  if (selection === null) return <EmptyDetails closeDetails={closeDetails} t={t} />
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- assembled clients add merge-extensible selection variants.
  if (selection.kind === 'tool') {
    return <ToolDetailsView {...props} selection={selection} matched={selection} />
  }
  return renderSlotChain('conversation.details.view', { selection, closeDetails, openDetails }, {
    fallback: <EmptyDetails closeDetails={closeDetails} t={t} />,
  })
}
