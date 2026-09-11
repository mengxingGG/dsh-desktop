/** Native account terminal controls and persisted invocation counters. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { CliProvider, CliLoginId, CliLoginSnapshot, CliAccountStatus, CliQuotaWindow } from '@deepseek-ai/dsh-agent-cli/types'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import css from './views.module.css'

/** Native Remote operations used by this browser surface. */
export interface CliApi {
  status(provider: CliProvider): Promise<RemoteResult<CliAccountStatus>>
  refresh(provider: CliProvider): Promise<RemoteResult<CliAccountStatus>>
  startLogin(provider: CliProvider): Promise<RemoteResult<CliLoginSnapshot>>
  loginInput(provider: CliProvider, id: CliLoginId, text: string): Promise<RemoteResult<void>>
  closeLogin(provider: CliProvider, id: CliLoginId): Promise<RemoteResult<CliAccountStatus>>
  refreshQuota(provider: CliProvider): Promise<RemoteResult<readonly CliQuotaWindow[] | null>>
}
function value<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
type Props = PropsLocale<'cliAgents'> & { api: CliApi }
const providers: CliProvider[] = ['grok-cli', 'antigravity-cli', 'codex-cli']
const providerLabels = { 'grok-cli': 'grok', 'antigravity-cli': 'agy', 'codex-cli': 'codex' } as const

function AccountCard({ provider, api, t, loginPollMs }: Props & { provider: CliProvider; loginPollMs: number }) {
  const [account, setAccount] = useState<CliAccountStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    let stopped = false
    void api.refresh(provider).then((result) => { if (!stopped) setAccount(value(result)) })
      .catch((error) => { if (!stopped) setError(String(error)) })
    return () => { stopped = true; alive.current = false }
  }, [api, provider])
  const active = account?.login?.status === 'running'
  useEffect(() => {
    if (!active) return
    let stopped = false, pending = false
    const timer = setInterval(() => {
      if (pending) return
      pending = true
      void api.status(provider).then((result) => { if (!stopped) setAccount(value(result)) })
        .catch((error) => { if (!stopped) setError(String(error)) }).finally(() => { pending = false })
    }, loginPollMs)
    return () => { stopped = true; clearInterval(timer) }
  }, [api, provider, active, loginPollMs])
  const run = (action: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    void action().then(async () => {
      const next = value(await api.status(provider))
      if (alive.current) setAccount(next)
    }).catch((error) => { if (alive.current) setError(String(error)) })
      .finally(() => { if (alive.current) setBusy(false) })
  }
  const login = account?.login
  const send = (text: string) => { if (login) run(async () => value(await api.loginInput(provider, login.id, text))) }
  const urls = [...new Set(login?.output.match(/https:\/\/[^\s<>\u001b]+/gu) ?? [])].filter((raw) => {
    try { const host = new URL(raw).hostname; return ['accounts.google.com', 'auth.x.ai', 'grok.com', 'accounts.x.ai', 'antigravity.google', 'auth.openai.com', 'auth0.openai.com', 'chatgpt.com'].some(domain => host === domain || host.endsWith('.' + domain)) }
    catch { return false }
  })
  return <section className={css.card}>
    <h3>{t(providerLabels[provider])}</h3>
    <p>{t(account?.installed ? 'installed' : 'missing')} · {t('modelCount')}: {account?.modelCount ?? 0}
      {' · '}{t(account?.authenticated === true ? 'signedIn' : 'unknown')}</p>
    <div className={css.actions}>
      <Button variant="outline" disabled={busy || active} onClick={() => run(async () => value(await api.refresh(provider)))}>{t('refresh')}</Button>
      <Button variant="outline" disabled={busy || active} onClick={() => run(async () => value(await api.startLogin(provider)))}>{t('login')}</Button>
      {provider !== 'grok-cli' && <Button variant="outline" disabled={busy || active} onClick={() => run(async () => value(await api.refreshQuota(provider)))}>{t('refreshQuota')}</Button>}
    </div>
    {busy && <p role="status">{t('loading')}</p>}
    {(error || account?.error) && <p role="alert">{error || account?.error}</p>}
    <p className={css.hint}>{t(provider === 'grok-cli' ? 'noQuota' : provider === 'codex-cli' ? 'codexQuotaHint' : 'quotaHint')}</p>
    {account?.quotaObservedAt && account.quota == null && <p>{t('quota')}: {t('unknown')}</p>}
    {account?.quota?.map(row => <p key={row.pool + row.window}>{row.pool} · {row.window}: {row.usedPercent}% {t('used')} · {t('reset')}: {row.resetsAt == null ? t('unknown') : new Date(row.resetsAt).toLocaleString()}</p>)}
    {account?.quotaObservedAt && <p>{t('observed')}: {new Date(account.quotaObservedAt).toLocaleString()}</p>}
    {login && <div>
      {active && <>
        <p>{t('running')}</p>
        {urls.map(url => <a key={url} href={url} target="_blank" rel="noopener noreferrer">{t('open')}</a>)}
        <div className={css.actions}>
          <Input type="password" autoComplete="off" aria-label={t('input')} value={input} onChange={event => setInput(event.target.value)} />
          <Button variant="outline" disabled={busy || !input} onClick={() => { send(input + '\r'); setInput('') }}>{t('send')}</Button>
          <Button variant="outline" disabled={busy} onClick={() => send('\r')}>{t('enter')}</Button>
          <Button variant="outline" disabled={busy} onClick={() => send('\u001b[A')}>{t('up')}</Button>
          <Button variant="outline" disabled={busy} onClick={() => send('\u001b[B')}>{t('down')}</Button>
          <Button variant="outline" disabled={busy} onClick={() => run(async () => value(await api.closeLogin(provider, login.id)))}>{t('close')}</Button>
        </div>
      </>}
      <details><summary>{t('output')}</summary><pre className={css.terminal}>{login.output}</pre></details>
      {login.error && <p role="alert">{login.error}</p>}
    </div>}
  </section>
}

/**
 * Show independent native login controls for the registered CLI providers.
 * @param props - Typed account Remote and locale.
 * @returns Native account settings cards.
 */
export function AccountSection(props: Props & { loginPollMs: number }) {
  return <div><p>{props.t('description')}</p><p className={css.hint}>{props.t('adapterHint')}</p>
    {providers.map(provider => <AccountCard key={provider} {...props} provider={provider} />)}</div>
}

/**
 * Render the latest native invocation below its conversation composer.
 * @param props - Persisted Session projections and locale.
 * @returns Native usage row only for the selected CLI provider.
 */
export function UsageBar(props: Props & PropsRuntime<'conversation.composer.dock'>) {
  const usage = props.useProjection('cliUsage')
  const selection = props.useProjection('modelSelection')
  const current = selection?.next ?? selection?.lastUsed
  const [account, setAccount] = useState<CliAccountStatus | null>(null)
  const provider = current?.provider
  useEffect(() => {
    setAccount(null)
    if (!provider || !providers.includes(provider as CliProvider)) return
    let stopped = false
    void props.api.status(provider as CliProvider).then((result) => {
      if (!stopped && result.ok) setAccount(result.value)
    }).catch(() => { /* Cached quota is optional; account settings displays query failures. */ })
    return () => { stopped = true }
  }, [props.api, provider, usage?.updatedAt])
  if (!current || !providers.includes(current.provider as CliProvider)) return null
  const reading = usage?.provider === current.provider && usage.model === current.model ? usage : null
  const n = (v: number | null | undefined) => v == null ? props.t('unknown') : v.toLocaleString()
  return <details className={css.usage}>
    <summary>{props.t(providerLabels[current.provider as CliProvider])} · {props.t('inputTokens')}: {n(reading?.inputTokens)}
      {' · '}{props.t('outputTokens')}: {n(reading?.outputTokens)} · {props.t('cache')}: {n(reading?.cacheReadTokens)}</summary>
    <p>{props.t('context')}: {n(reading?.contextTokens)} / {n(reading?.contextWindow)}</p>
    <p>{props.t('cost')}: {n(reading?.costUsd)}</p>
    <p>{props.t('quota')}: {account?.quota == null ? props.t('unknown') : account.quota.map(row => row.pool + ' · ' + row.window + ': ' + row.usedPercent + '% ' + props.t('used')).join(' / ')}</p>
    <p className={css.hint}>{props.t('usageHint')}</p>
  </details>
}
