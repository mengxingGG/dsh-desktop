/** Claude login and quota settings rendered from the Host account observation. */

import { useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountInjected } from './controller.ts'
import { windowLabels, type NS } from './locales.ts'
import css from './AccountSection.module.css'

export type AccountSectionProps = InjectFace<AccountInjected> & PropsLocale<typeof NS>

/**
 * Render account actions, native authorization progress and timestamped quota windows.
 * @param props - renderer-bound account source, actions and localized copy.
 * @returns the Claude Code settings section.
 */
export function AccountSection(props: AccountSectionProps) {
  const { t } = props
  const snapshot = props.useAccount(value => value)
  const [code, setCode] = useState('')
  useEffect(() =>{  props.load() }, [props.load])
  const value = snapshot.value
  const login = value?.login
  const authorization = login?.output.match(/https:\/\/(?:claude\.ai|platform\.claude\.com|console\.anthropic\.com)\/[^\s\u001b]+/u)?.[0]
  return <section className={css.section}>
    <p>{t('description')}</p>
    <div className={css.actions}>
      <Button variant="outline" disabled={snapshot.busy} onClick={props.refresh}>{t('refresh')}</Button>
      <Button variant="outline" disabled={snapshot.busy} onClick={props.refreshQuota}>{t('refreshQuota')}</Button>
      <Button variant="primary" disabled={snapshot.busy || login?.status === 'running'} onClick={props.startLogin}>{t('login')}</Button>
    </div>
    {snapshot.busy && <p role="status">{t('loading')}</p>}
    {snapshot.error !== null && <p role="alert">{snapshot.error}</p>}
    {value?.account != null && <p>{t(value.account.loggedIn ? 'signedIn' : 'signedOut')}{value.account.email === null ? '' : ` · ${value.account.email}`}</p>}
    {login != null && <div className={css.login}>
      <strong>{t(login.status)}</strong>
      {login.status === 'running' && <>
        <p>{t('waiting')}</p>
        {authorization !== undefined && <a href={authorization} target="_blank" rel="noopener noreferrer">{t('open')}</a>}
        <div className={css.actions}>
          <Input type="password" autoComplete="off" aria-label={t('code')} value={code} onChange={(event) =>{  setCode(event.target.value) }} />
          <Button variant="primary" disabled={snapshot.busy || code.trim() === ''} onClick={() => { props.submitCode(code.trim()); setCode('') }}>{t('submit')}</Button>
          <Button variant="ghost" disabled={snapshot.busy} onClick={props.cancelLogin}>{t('cancel')}</Button>
        </div>
      </>}
      <pre className={css.output} aria-label={t('output')}>{login.output}</pre>
      {login.truncated && <p>{t('truncated')}</p>}
      {login.error !== null && <p role="alert">{login.error}</p>}
    </div>}
    {value?.quota == null ? <p>{t('noQuota')}</p> : <div className={css.windows}>
      {Object.entries(value.quota.windows).map(([name, window]) => <div key={name} className={css.window}>
        <strong>{windowLabels[name] === undefined ? name : t(windowLabels[name])}</strong>
        <span>{t('used')}: {window.usedPercent === null ? t('unknown') : `${window.usedPercent}%`}</span>
        {window.usedPercent !== null && <progress max={100} value={window.usedPercent}
          aria-label={windowLabels[name] === undefined ? name : t(windowLabels[name])} />}
        <small>{t('resets')}: {window.resetsAt === null ? t('unknown') : new Date(window.resetsAt).toLocaleString()}</small>
        <small>{t('observed')}: {new Date(window.updatedAt).toLocaleString()}</small>
      </div>)}
    </div>}
  </section>
}
