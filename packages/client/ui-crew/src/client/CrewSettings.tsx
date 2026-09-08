/** User-global role defaults and editable operating memory. */

import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CrewAgentOptionsSnapshot, CrewMemoryEntry, CrewRole } from '@deepseek-ai/dsh-crew/client'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { ROLES, type CrewSettingsInjected } from './preferences.ts'
import type { NS } from './locales.ts'
import css from './CrewSettings.module.css'

/** Settings slot props; all mutable Host data arrives through framework hooks. */
export type CrewSettingsProps = InjectFace<CrewSettingsInjected> & PropsLocale<typeof NS>

interface MemoryDraft {
  id: string
  entry: CrewMemoryEntry
  revision: number
}

/**
 * Render global role choices and explicit, revision-fenced memory edits.
 * @param props - Settings mirror, catalog, write operations, and locale.
 * @returns The Crew settings section.
 */
export function CrewSettings(props: CrewSettingsProps) {
  const { t } = props
  const snapshot = props.usePreferences(value => value)
  const revision = snapshot.revision
  const catalog = props.useCatalog(value => value)
  const [draft, setDraft] = useState<MemoryDraft>()
  const [removal, setRemoval] = useState<{ id: string; revision: number }>()
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<'settingsSaved' | 'settingsSaveFailed'>()
  useEffect(() => { props.loadCatalog() }, [props.loadCatalog])
  const disabled = saving || snapshot.status !== 'ready' || !snapshot.writable || snapshot.mode !== 'host'
  const entries = Object.entries(snapshot.value?.memory ?? {})
  const choices = catalog.value?.groups.flatMap(group => group.models.map(model => ({
    key: JSON.stringify([group.id, model.id]),
    provider: group.id,
    providerName: group.name,
    model,
  }))) ?? []

  async function write(operation: () => Promise<boolean>, settled?: () => void): Promise<void> {
    setSaving(true)
    setNotice(undefined)
    try {
      const saved = await operation()
      setNotice(saved ? 'settingsSaved' : 'settingsSaveFailed')
      if (saved) settled?.()
    } catch {
      // Settings transport failures leave the authoritative mirror intact and the draft available.
      setNotice('settingsSaveFailed')
    } finally {
      setSaving(false)
    }
  }

  function roleRow(role: CrewRole) {
    const selected = snapshot.value?.roles[role] ?? {}
    const key = selected.provider === undefined ? '' : JSON.stringify([selected.provider, selected.model])
    const candidate = choices.find(choice => choice.key === key)
    const efforts = candidate?.model.reasoning?.efforts ?? []
    return (
      <fieldset key={role} className={css.role} disabled={disabled}>
        <legend>{t(role)}</legend>
        <label>
          <span>{t('settingsModel')}</span>
          <select aria-label={`${t(role)} · ${t('settingsModel')}`} value={key} onChange={(event) => {
            if (revision === undefined) return
            const choice = choices.find(item => item.key === event.target.value)
            const options = choice === undefined ? {} : { provider: choice.provider, model: choice.model.id }
            void write(() => props.saveRole(role, options, revision))
          }}>
            <option value="">{t('settingsInherit')}</option>
            {choices.map(choice => <option key={choice.key} value={choice.key}>{`${choice.providerName} · ${choice.model.name}`}</option>)}
            {key !== '' && candidate === undefined
              ? <option value={key}>{`${selected.provider} / ${selected.model} · ${t('settingsModelUnavailable')}`}</option>
              : null}
          </select>
        </label>
        {efforts.length > 0 || selected.reasoningEffort !== undefined
          ? (
            <label>
              <span>{t('settingsReasoning')}</span>
              <select aria-label={`${t(role)} · ${t('settingsReasoning')}`} value={selected.reasoningEffort ?? ''} onChange={(event) => {
                if (revision === undefined) return
                const options = { ...selected }
                if (event.target.value === '') delete options.reasoningEffort
                else options.reasoningEffort = event.target.value as NonNullable<CrewAgentOptionsSnapshot['reasoningEffort']>
                void write(() => props.saveRole(role, options, revision))
              }}>
                <option value="">{t('settingsReasoningDefault')}</option>
                {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
                {selected.reasoningEffort !== undefined && !efforts.some(effort => effort.id === selected.reasoningEffort)
                  ? <option value={selected.reasoningEffort}>{selected.reasoningEffort}</option>
                  : null}
              </select>
            </label>
          )
          : null}
      </fieldset>
    )
  }

  return (
    <section className={css.section} data-crew-settings>
      <h2>{t('settingsTitle')}</h2>
      <p>{t('settingsGlobal')}</p>
      {snapshot.status === 'loading' ? <p role="status">{t('settingsLoading')}</p> : null}
      {snapshot.status !== 'loading' && (snapshot.status !== 'ready' || !snapshot.writable || snapshot.mode !== 'host')
        ? <p role="status">{t('settingsReadOnly')}</p> : null}
      <h3>{t('settingsRoles')}</h3>
      <p>{t('settingsRolesHelp')}</p>
      {catalog.status === 'loading' ? <p role="status">{t('settingsCatalogLoading')}</p> : null}
      {catalog.status === 'error'
        ? <p role="alert">{t('settingsCatalogError')} <button type="button" onClick={props.loadCatalog}>{t('settingsRetry')}</button></p> : null}
      {(catalog.value?.failures.length ?? 0) > 0 ? <p>{t('settingsCatalogPartial')}</p> : null}
      <div className={css.roles}>{ROLES.map(roleRow)}</div>
      <h3>{t('settingsMemory')}</h3>
      <p>{t('settingsMemoryHelp')}</p>
      <p className={css.warning}>{t('settingsDangerous')}</p>
      {entries.length === 0 ? <p>{t('settingsMemoryEmpty')}</p> : null}
      <ul className={css.memories}>
        {entries.map(([id, entry]) => (
          <li key={id}>
            <span className={css.kind}>{t(entry.kind === 'authorization' ? 'settingsAuthorization' : 'settingsPreference')}</span>
            <p className={css.prose}>{entry.text}</p>
            <p>{`${t('settingsScope')}: ${entry.scope}`}</p>
            <div className={css.actions}>
              <button type="button" disabled={disabled} onClick={() => {
                if (revision === undefined) return
                setRemoval(undefined)
                setNotice(undefined)
                setDraft({ id, entry: { ...entry }, revision })
              }}>{t('settingsEdit')}</button>
              <button type="button" disabled={disabled} onClick={() => {
                if (revision === undefined) return
                setDraft(undefined)
                setRemoval({ id, revision })
              }}>{t('settingsDelete')}</button>
            </div>
            {removal?.id === id
              ? (
                <div role="group" aria-label={t('settingsDeleteConfirm')} className={css.confirmation}>
                  <p>{t('settingsDeleteConfirm')}</p>
                  <button type="button" disabled={saving} onClick={() => { setRemoval(undefined) }}>{t('settingsCancel')}</button>
                  <button type="button" disabled={disabled} onClick={() => {
                    void write(() => props.deleteMemory(id, removal.revision), () => { setRemoval(undefined) })
                  }}>{t('settingsConfirmDelete')}</button>
                </div>
              )
              : null}
          </li>
        ))}
      </ul>
      <button type="button" disabled={disabled || draft !== undefined} onClick={() => {
        if (revision === undefined) return
        setRemoval(undefined)
        setNotice(undefined)
        setDraft({ id: `memory-${randomUUID()}`, entry: { kind: 'preference', text: '', scope: '' }, revision })
      }}>{t('settingsAddMemory')}</button>
      {draft === undefined ? null : (
        <form className={css.editor} onSubmit={(event) => {
          event.preventDefault()
          void write(() => props.saveMemory(draft.id, draft.entry, draft.revision), () => { setDraft(undefined) })
        }}>
          <label><span>{t('settingsKind')}</span>
            <select value={draft.entry.kind} disabled={disabled} onChange={(event) => {
              const kind = event.target.value === 'authorization' ? 'authorization' : 'preference'
              setDraft({ ...draft, entry: { ...draft.entry, kind } })
            }}>
              <option value="preference">{t('settingsPreference')}</option>
              <option value="authorization">{t('settingsAuthorization')}</option>
            </select>
          </label>
          {draft.entry.kind === 'authorization' ? <p className={css.warning}>{t('settingsAuthorizationHelp')}</p> : null}
          <label><span>{t('settingsMemoryText')}</span>
            <textarea required value={draft.entry.text} disabled={disabled} onChange={(event) => {
              setDraft({ ...draft, entry: { ...draft.entry, text: event.target.value } })
            }} />
          </label>
          <label><span>{t('settingsScope')}</span>
            <textarea required value={draft.entry.scope} disabled={disabled} onChange={(event) => {
              setDraft({ ...draft, entry: { ...draft.entry, scope: event.target.value } })
            }} />
          </label>
          <div className={css.actions}>
            <button type="button" disabled={saving} onClick={() => { setDraft(undefined); setNotice(undefined) }}>{t('settingsCancel')}</button>
            <button type="submit" disabled={disabled || draft.entry.text.trim() === '' || draft.entry.scope.trim() === ''}>
              {t(draft.entry.kind === 'authorization' ? 'settingsSaveAuthorization' : 'settingsSave')}
            </button>
          </div>
        </form>
      )}
      {notice === undefined ? null : <p role={notice === 'settingsSaveFailed' ? 'alert' : 'status'}>{t(notice)}</p>}
    </section>
  )
}
