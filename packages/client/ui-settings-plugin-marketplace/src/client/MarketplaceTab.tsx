import { useId, useState, type FormEvent, type ReactNode } from 'react'
import type {
  MarketplaceEntry,
  MarketplaceInstallReceipt,
  MarketplaceSearchResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconChevronDownOutline14,
  IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './MarketplaceTab.module.css'

/** Registration-side Remote face used by the marketplace tab. */
export interface MarketplaceInjected {
  search: (query: string) => Promise<MarketplaceSearchResult>
  install: (entry: MarketplaceEntry) => Promise<MarketplaceInstallReceipt>
  confirm: (entry: MarketplaceEntry) => boolean
}

/** Full component props assembled by the Settings slot renderer. */
export type MarketplaceProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginMarketplace'>
  & InjectFace<MarketplaceInjected>

type SearchState =
  | { readonly status: 'idle' }
  | { readonly status: 'searching' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly result: MarketplaceSearchResult }

interface Notice {
  readonly kind: 'success' | 'error'
  readonly message: string
}

const EXAMPLES = ['balance', 'memory', 'tools'] as const

/** Render discovery guidance, cards, expandable details, and explicit installation actions. */
export function MarketplaceTab({ search, install, confirm, t }: MarketplaceProps): ReactNode {
  const detailsPrefix = useId()
  const [query, setQuery] = useState('')
  const [state, setState] = useState<SearchState>({ status: 'idle' })
  const [expanded, setExpanded] = useState<string>()
  const [installing, setInstalling] = useState<string>()
  const [notice, setNotice] = useState<Notice>()

  const runSearch = async (value: string): Promise<void> => {
    setState({ status: 'searching' })
    setExpanded(undefined)
    setNotice(undefined)
    try {
      setState({ status: 'ready', result: await search(value) })
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    void runSearch(query)
  }

  const installEntry = async (entry: MarketplaceEntry): Promise<void> => {
    if (!confirm(entry)) return
    setInstalling(entry.repository)
    setNotice(undefined)
    try {
      const receipt = await install(entry)
      setNotice({ kind: 'success', message: t('installed', { packageName: receipt.packageName }) })
    } catch (error) {
      setNotice({
        kind: 'error',
        message: t('installError', { message: error instanceof Error ? error.message : String(error) }),
      })
    } finally {
      setInstalling(undefined)
    }
  }

  const entries = state.status === 'ready' ? state.result.entries : []
  return (
    <div className={css.root} aria-busy={state.status === 'searching'}>
      <div>
        <h3 className={css.title}>{t('title')}</h3>
        <p className={css.intro}>{t('intro')}</p>
      </div>
      <form className={css.form} onSubmit={submit}>
        <label htmlFor="plugin-marketplace-query">{t('label')}</label>
        <div className={css.searchRow}>
          <span className={css.searchInput}>
            <IconSearchOutline16 aria-hidden="true" />
            <input
              id="plugin-marketplace-query"
              type="search"
              maxLength={100}
              value={query}
              placeholder={t('placeholder')}
              onChange={(event) => { setQuery(event.currentTarget.value) }}
            />
          </span>
          <button className={css.primary} type="submit" disabled={state.status === 'searching'}>
            {t('search')}
          </button>
        </div>
        <div className={css.examples}>
          <span>{t('examples')}</span>
          {EXAMPLES.map(example => (
            <button
              className={css.chip}
              key={example}
              type="button"
              onClick={() => {
                setQuery(example)
                void runSearch(example)
              }}
            >
              {example}
            </button>
          ))}
        </div>
      </form>
      <p className={css.security}>{t('security')}</p>
      <div className={css.heading}>
        <h3>{t('results')}</h3>
        {state.status === 'ready' && state.result.rateLimitRemaining !== null
          ? <span>{t('remaining', { count: state.result.rateLimitRemaining })}</span>
          : null}
      </div>
      {state.status === 'idle' ? <p className={css.status}>{t('initial')}</p> : null}
      {state.status === 'searching' ? <p className={css.status}>{t('searching')}</p> : null}
      {state.status === 'error' ? (
        <p className={`${css.status} ${css.error}`} role="alert">{t('error')} {state.message}</p>
      ) : null}
      {state.status === 'ready' && entries.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
      {notice === undefined ? null : (
        <p className={css.notice} data-kind={notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'}>
          {notice.message}
        </p>
      )}
      {entries.length === 0 ? null : (
        <ul className={css.cards}>
          {entries.map((entry) => {
            const open = expanded === entry.repository
            const busy = installing === entry.repository
            const detailsId = `${detailsPrefix}-${encodeURIComponent(entry.repository)}`
            return (
              <li className={css.card} key={entry.repository} data-open={open ? 'true' : undefined}>
                <div className={css.cardHead}>
                  <div className={css.cardCopy}>
                    <a href={entry.htmlUrl} target="_blank" rel="noreferrer">{entry.repository}</a>
                    <code>{entry.packageName}</code>
                    <p>{entry.description ?? entry.packageName}</p>
                    <span>★ {entry.stars} · ⑂ {entry.forks}</span>
                  </div>
                  <button
                    className={`${css.primary} ${css.install}`}
                    type="button"
                    disabled={installing !== undefined}
                    onClick={() => { void installEntry(entry) }}
                  >
                    {busy ? t('installing') : t('install')}
                  </button>
                </div>
                <button
                  className={css.toggle}
                  type="button"
                  aria-expanded={open}
                  aria-controls={detailsId}
                  onClick={() => {
                    setExpanded(current => current === entry.repository ? undefined : entry.repository)
                  }}
                >
                  {open ? t('hide') : t('details')}
                  <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
                </button>
                {open ? (
                  <dl className={css.details} id={detailsId}>
                    <div><dt>{t('package')}</dt><dd>{entry.packageName}</dd></div>
                    <div><dt>{t('branch')}</dt><dd>{entry.defaultBranch}</dd></div>
                    <div><dt>{t('license')}</dt><dd>{entry.license ?? t('unlicensed')}</dd></div>
                    <div><dt>{t('updated')}</dt><dd>{new Date(entry.updatedAt).toLocaleDateString()}</dd></div>
                    <div>
                      <dt>{t('repository')}</dt>
                      <dd><a href={entry.htmlUrl} target="_blank" rel="noreferrer">{entry.htmlUrl}</a></dd>
                    </div>
                  </dl>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
