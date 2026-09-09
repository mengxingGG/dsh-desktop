/** Claude request counters and account quota below the active conversation composer. */

import { useEffect } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-subagent-claude-code/engine-types'
import type { AccountInjected } from './controller.ts'
import { windowLabels } from './locales.ts'
import css from './UsageBar.module.css'

/** Session-scoped counters with the shared account controller's actions. */
export type UsageBarProps = PropsRuntime<'conversation.composer.dock'> & PropsLocale<'claudeCode'>
  & InjectFace<AccountInjected> & { quotaRefreshMs: number }

/**
 * Show the latest native request separately from account-wide usage windows.
 * @param props - Session projections, shared account observation, locale and refresh cadence.
 * @returns a compact expandable status row for Claude conversations.
 */
export function UsageBar(props: UsageBarProps) {
  const { t, useProjection, load, refreshQuota, quotaRefreshMs } = props
  const usage = useProjection('claudeUsage')
  const selection = useProjection('modelSelection')
  const account = props.useAccount(value => value)
  const current = selection?.next ?? selection?.lastUsed
  const visible = current?.provider === 'claude-code' || (current == null && usage != null)
  useEffect(() => {
    if (!visible) return
    load()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refreshQuota() }, quotaRefreshMs)
    return () => { clearInterval(timer) }
  }, [visible, load, refreshQuota, quotaRefreshMs])
  if (!visible) return null
  const reading = usage?.model === current?.model || current == null ? usage : null
  const tokens = (value: number | null | undefined): string => value == null ? t('unknown') : value.toLocaleString()
  const percent = (value: number | null | undefined): string => value == null ? t('unknown') : `${Math.round(value)}%`
  const occupancy = reading?.contextTokens != null && reading.contextWindow != null
    ? reading.contextTokens / reading.contextWindow * 100 : null
  const cacheHit = reading?.contextTokens != null && reading.contextTokens > 0 && reading.cacheReadTokens != null
    ? reading.cacheReadTokens / reading.contextTokens * 100 : null
  const windows = account.value?.quota?.windows
  const time = (value: number | null | undefined): string => value == null ? t('unknown') : new Date(value).toLocaleString()
  return <div className={css.root}>
    <details className={css.details}>
      <summary className={css.summary}>
        <span>{t('title')}</span>
        <span>{t('context')}: {percent(occupancy)}</span>
        <span>{t('cacheHit')}: {percent(cacheHit)}</span>
        <span>{t('fiveHour')} {t('used')}: {percent(windows?.five_hour?.usedPercent)}</span>
        <span>{t('sevenDay')} {t('used')}: {percent(windows?.seven_day?.usedPercent)}</span>
      </summary>
      <div className={css.panel}>
        <p>{t('requestContext')}: {tokens(reading?.contextTokens)} / {tokens(reading?.contextWindow)}</p>
        <p>{t('uncachedInput')}: {tokens(reading?.inputTokens)} · {t('outputTokens')}: {tokens(reading?.outputTokens)}</p>
        <p>{t('cacheRead')}: {tokens(reading?.cacheReadTokens)} · {t('cacheWrite')}: {tokens(reading?.cacheWriteTokens)}</p>
        <p>{t('requestObserved')}: {time(reading?.updatedAt)}</p>
        <p className={css.explanation}>{t('usageExplanation')}</p>
        {Object.entries(windows ?? {}).map(([key, window]) => <p key={key}>
          {windowLabels[key] === undefined ? key : t(windowLabels[key])}: {percent(window.usedPercent)} {t('used')}
          {' · '}{t('resets')}: {time(window.resetsAt)}{' · '}{t('observed')}: {time(window.updatedAt)}
        </p>)}
        <p className={css.explanation}>{t('quotaExplanation')}</p>
        {account.error != null && <p role="status">{account.error}</p>}
      </div>
    </details>
    <button type="button" className={css.refresh} disabled={account.busy} onClick={refreshQuota} title={t('refreshQuota')}>
      {account.busy ? t('loading') : t('refreshQuota')}
    </button>
  </div>
}
