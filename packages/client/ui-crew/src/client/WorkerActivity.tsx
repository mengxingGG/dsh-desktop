/** Read-only worker output from the shared Chat projection. */

import { useEffect } from 'react'
import type { ChatConversationViewNode, ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { CrewDetailsViewProps } from './CrewDetailsView.tsx'
import css from './CrewPanel.module.css'

type Translate = CrewDetailsViewProps['t']

function ToolActivity({ block, t }: { block: ToolCallBlock; t: Translate }) {
  const settled = 'kind' in block
  const name = settled ? block.call?.name ?? block.callId : block.name
  const args = settled ? block.call?.argsRaw : block.argsRaw
  return (
    <details className={css.command}>
      <summary>{name} · {t(settled ? block.isError ? 'statusFailed' : 'statusPassed' : 'statusRunning')}</summary>
      {args !== undefined && <pre className={css.log}>{args}</pre>}
      {settled && block.content.map((part, index) => part.type === 'text'
        ? <pre key={index} className={css.log}>{part.text}</pre> : null)}
      {block.subCalls.map(child => <ToolActivity key={child.callId} block={child} t={t} />)}
    </details>
  )
}

function ActivityRecord({ value, t }: { value: ChatConversationViewNode; t: Translate }) {
  // The Chat target publishes payloads from its merge-extensible typed Node registry.
  const node = value as ChatNode
  switch (node.kind) {
    case 'assistant-step':
      return <div className={css.block}>{node.data.blocks.map((block, index) => {
        if (block.kind === 'text') return <pre key={index} className={css.log}>{block.text}</pre>
        if (block.kind === 'reasoning') return (
          <details key={index} className={css.command}>
            <summary>{t('activityReasoning')}</summary><pre className={css.log}>{block.text}</pre>
          </details>
        )
        return null
      })}</div>
    case 'tool-call': return <ToolActivity block={node.data.root} t={t} />
    case 'user':
    case 'steering':
      return <details className={css.command}>
        <summary>{t('activityInstruction')}</summary>
        {node.data.content.map((part, index) => part.type === 'text'
          ? <pre key={index} className={css.log}>{part.text}</pre> : null)}
      </details>
    case 'turn-error': return <p role="alert">{node.data.message}</p>
    default:
      // Other installed Chat kinds own navigation, context, and transcript chrome.
      return null
  }
}

/**
 * Render live text, calls, results, and paged history without exposing child input.
 * @param props - renderer-bound activity source and selected worker identity.
 * @returns the worker activity section.
 */
export function WorkerActivity({ sessionId, observeWorker, useActivity, loadOlderActivity, t }: Pick<
  CrewDetailsViewProps, 'observeWorker' | 'useActivity' | 'loadOlderActivity' | 't'
> & { sessionId: import('@deepseek-ai/dsh-session/types').SessionId | undefined }) {
  const activity = useActivity(value => value)
  useEffect(() => observeWorker(sessionId), [sessionId, observeWorker])
  const current = activity.sessionId === sessionId ? activity : undefined
  return (
    <section className={css.card} aria-label={t('activity')} data-crew-activity>
      <h3>{t('activity')}</h3>
      <p className={css.readOnly}>{sessionId ?? t('none')}</p>
      {sessionId === undefined ? <p>{t('activityEmpty')}</p> : <>
        <p role="status">{t(current?.status === 'error' ? 'activityError'
          : current?.status !== 'open' ? 'activityLoading'
            : current.session?.running ? 'statusRunning' : 'activityInactive')}</p>
        {current?.error !== undefined && <p role="alert">{current.error}</p>}
        {current?.hasMore && <button type="button" disabled={current.session?.loadingOlder}
          onClick={loadOlderActivity}>{t('activityOlder')}</button>}
        {current?.nodes.map(node => <ActivityRecord key={node.key} value={node} t={t} />)}
        {current?.status === 'open' && current.nodes.length === 0 && <p>{t('activityEmpty')}</p>}
      </>}
    </section>
  )
}
