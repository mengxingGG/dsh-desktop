/** Built-in Tool branch of the typed details-view chain. */

import { Fragment } from 'react'
import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import { shallowEqual } from '@deepseek-ai/dsh-client-store'
import type { ChatSnapshot, RunningToolCall, ToolCallBlock, ToolResultNode } from '../contract/snapshot.ts'
import type { ToolDetailsViewProps } from '../contract/slots.ts'
import { findToolCall } from './tool-node-reader.ts'
import css from './DetailsPanel.module.css'

/** The snapshot-owned block reference must remain stable across unrelated frames. */
interface CallMaterial {
  name: string
  argsRaw: string | null
  block: ToolCallBlock
}

function settledMaterial(node: ToolResultNode, callId: string): CallMaterial {
  return { name: node.call?.name ?? callId, argsRaw: node.call?.argsRaw ?? null, block: node }
}

function runningMaterial(call: RunningToolCall): CallMaterial {
  return { name: call.name, argsRaw: call.argsRaw, block: call }
}

function materialFor(snapshot: ChatSnapshot, callId: string): CallMaterial | null {
  const found = findToolCall(snapshot, callId)
  if (found === undefined) return null
  return 'kind' in found ? settledMaterial(found, callId) : runningMaterial(found)
}

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

/** Flatten a settled result for the no-ui-tool fallback. */
function rawResultText(block: ToolCallBlock): string {
  if (!('kind' in block)) return ''
  const parts = block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  if (parts.length === 0 && block.error !== undefined) parts.push(`${block.error.name}: ${block.error.code}`)
  return parts.join('\n')
}

/** Render the complete details surface for one Tool-call selection. */
export function ToolDetailsView({
  matched, useChat, useSessions, sessionId, renderSlot, closeDetails, t,
}: ToolDetailsViewProps) {
  const sessionCwd = useSessions(list => list.byId[sessionId]?.cwd)
  const callId = matched.callId
  const material = useChat(
    snapshot => (callId === undefined ? null : materialFor(snapshot, callId)),
    (left, right) => shallowEqual(left, right),
  )
  return (
    <div className={css.root}>
      <div className={css.header}>
        <div className={css.title}>{material?.name ?? matched.toolName ?? t('details.title')}</div>
        <button type="button" className={css.close} aria-label={t('details.close')} onClick={closeDetails}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className={css.body}>
        {callId === undefined
          ? <div className={css.empty}>{t('details.empty')}</div>
          : material === null
            ? <div className={css.empty}>{t('details.notInWindow')}</div>
            : (
              <>
                {material.argsRaw !== null && (
                  <section className={css.section}>
                    <div className={css.sectionLabel}>{t('details.input')}</div>
                    <CodeBlock code={pretty(material.argsRaw)} lang="json" copyLabel={t('copy')} copiedLabel={t('copied')} />
                  </section>
                )}
                <section className={css.section}>
                  <div className={css.sectionLabel}>{t('details.output')}</div>
                  <Fragment key={callId}>
                    {renderSlot('conversation.details.tool', { block: material.block, cwd: sessionCwd }, {
                      fallback: 'kind' in material.block
                        ? (
                          <pre className={css.code} data-error={material.block.isError || undefined}>
                            {rawResultText(material.block)}
                          </pre>
                        )
                        : <div className={css.empty}>{t('details.running')}</div>,
                    })}
                  </Fragment>
                </section>
              </>
            )}
      </div>
    </div>
  )
}
