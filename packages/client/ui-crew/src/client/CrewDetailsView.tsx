/** Live, manager-only Crew project and worker evidence view. */

import type { ReactNode } from 'react'
import {
  IconCloseOutline16, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  CrewCommandResult, CrewIssue, CrewProjectionView, CrewStage, CrewWorkItemSnapshot,
} from '@deepseek-ai/dsh-crew/client'
import { NS, type CrewKey } from './locales.ts'
import type { CrewDetailsSelection } from './selection.ts'
import type { CrewActivityInjected } from './activity.ts'
import { WorkerActivity } from './WorkerActivity.tsx'
import css from './CrewPanel.module.css'

/** Full props of the Crew branch in Chat's typed details chain. */
export type CrewDetailsViewProps =
  PropsRuntime<'conversation.details.view'>
  & { matched: CrewDetailsSelection }
  & PropsLocale<typeof NS>
  & InjectFace<CrewActivityInjected>

function terminal(stage: CrewStage): boolean {
  return stage === 'accepted' || stage === 'failed' || stage === 'cancelled'
}

function stageKey(stage: CrewStage): CrewKey {
  return `stage.${stage}`
}

function stageState(stage: CrewStage): 'done' | 'error' | 'ongoing' {
  if (stage === 'failed' || stage === 'cancelled' || stage === 'revision_required') return 'error'
  if (stage === 'accepted' || stage === 'integration_ready') return 'done'
  return 'ongoing'
}

function integrationStatusKey(status: 'running' | 'passed' | 'failed' | 'cancelled'): CrewKey {
  switch (status) {
    case 'running': return 'statusRunning'
    case 'passed': return 'statusPassed'
    case 'failed': return 'statusFailed'
    case 'cancelled': return 'statusCancelled'
  }
}

function shortId(value: string | undefined): string {
  if (value === undefined) return '—'
  return value.length <= 10 ? value : `…${value.slice(-8)}`
}

function List({ values, empty }: { values: readonly string[]; empty: string }) {
  if (values.length === 0) return <span>{empty}</span>
  return <ul className={css.values}>{values.map(value => <li key={value}>{value}</li>)}</ul>
}

function EvidenceRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={css.evidenceRow}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function IssueEvidence({ issues, t }: { issues: readonly CrewIssue[]; t: CrewDetailsViewProps['t'] }) {
  if (issues.length === 0) return <p>{t('none')}</p>
  return (
    <ul className={css.values}>
      {issues.map((issue, index) => (
        <li key={index}>
          <p>{issue.path}{issue.line === undefined ? '' : `:${issue.line}`} · {issue.message}</p>
          <dl className={css.evidence}>
            <EvidenceRow label={t('expectedCorrection')}>{issue.expected}</EvidenceRow>
          </dl>
        </li>
      ))}
    </ul>
  )
}

function CommandOutput({ label, value, truncated, t }: {
  label: string
  value: string
  truncated: boolean
  t: CrewDetailsViewProps['t']
}) {
  return (
    <div className={css.commandOutput}>
      <h6>{label}</h6>
      {truncated && <p className={css.readOnly}>{t('outputTruncated')}</p>}
      {value.length === 0
        ? <p className={css.readOnly}>{t('noOutput')}</p>
        : <pre className={css.log} role="region" aria-label={label} tabIndex={0}>{value}</pre>}
    </div>
  )
}

function CommandEvidence({ commands, t }: {
  commands: readonly CrewCommandResult[]
  t: CrewDetailsViewProps['t']
}) {
  if (commands.length === 0) return <p>{t('none')}</p>
  return (
    <ol className={css.commands}>
      {commands.map(command => (
        <li key={command.commandId}>
          <details className={css.command}>
            <summary><code>{command.argv.join(' ')}</code></summary>
            <dl className={css.evidence}>
              <EvidenceRow label={t('workingDirectory')}>{command.cwd}</EvidenceRow>
              <EvidenceRow label={t('exitCode')}>{command.exitCode ?? t('notRecorded')}</EvidenceRow>
              <EvidenceRow label={t('signal')}>{command.signal ?? t('none')}</EvidenceRow>
              <EvidenceRow label={t('timedOut')}>{t(command.timedOut ? 'yes' : 'no')}</EvidenceRow>
            </dl>
            <CommandOutput label={t('stdout')} value={command.stdout} truncated={command.stdoutTruncated} t={t} />
            <CommandOutput label={t('stderr')} value={command.stderr} truncated={command.stderrTruncated} t={t} />
          </details>
        </li>
      ))}
    </ol>
  )
}

function WorkerRow({
  item, selected, select, t,
}: {
  item: CrewWorkItemSnapshot
  selected: boolean
  select: () => void
  t: CrewDetailsViewProps['t']
}) {
  return (
    <button
      type="button"
      className={css.worker}
      aria-pressed={selected}
      onClick={select}
    >
      <StateDot state={stageState(item.stage)} />
      <span className={css.workerText}>
        <strong>{item.moduleKey}</strong>
        <small>{t(stageKey(item.stage))} · {shortId(item.developerSessionId)}</small>
      </span>
    </button>
  )
}

function managerStatus(state: CrewProjectionView, t: CrewDetailsViewProps['t']): string {
  if (state.workItems.some(item => (
    item.stage === 'revision_required' || item.stage === 'paused' || item.stage === 'failed'
  ))) return t('managerAttention')
  if (state.workItems.some(item => !terminal(item.stage))) return t('managerWorking')
  return t('managerIdle')
}

/** Render one selected work item's immutable host and worker evidence. */
function WorkItemEvidence({
  state, item, t,
}: {
  state: CrewProjectionView
  item: CrewWorkItemSnapshot
  t: CrewDetailsViewProps['t']
}) {
  const verification = state.verifications.find(value => value.id === item.latestVerificationId)
  const review = state.reviews.find(value => value.id === item.latestReviewId)
  const report = state.reports.find(value => value.id === item.latestReportId)
  return (
    <section className={css.card} aria-label={`${t('module')}: ${item.moduleKey}`}>
      <h3>{item.moduleKey}</h3>
      <p className={css.readOnly}>{t('readOnly')}</p>
      <dl className={css.evidence}>
        <EvidenceRow label={t('stage')}>
          <span className={css.inlineState}><StateDot state={stageState(item.stage)} /> {t(stageKey(item.stage))}</span>
        </EvidenceRow>
        <EvidenceRow label={t('role')}>
          {item.stage === 'reviewing' ? t('reviewer') : t('developer')}
        </EvidenceRow>
        <EvidenceRow label={t('session')}>
          {shortId(item.stage === 'reviewing' ? item.reviewerSessionId : item.developerSessionId)}
        </EvidenceRow>
        <EvidenceRow label={t('reason')}>{item.reason ?? t('none')}</EvidenceRow>
        <EvidenceRow label={t('paths')}><List values={verification?.changedPaths ?? []} empty={t('none')} /></EvidenceRow>
        <EvidenceRow label={t('outOfScope')}><List values={verification?.outOfScopePaths ?? []} empty={t('none')} /></EvidenceRow>
        <EvidenceRow label={t('missing')}><List values={verification?.missingArtifacts ?? []} empty={t('none')} /></EvidenceRow>
      </dl>
      {report !== undefined && (
        <div className={css.block}>
          <h4>{t('reports')}</h4>
          <p>{report.summary}</p>
        </div>
      )}
      {verification !== undefined && (
        <div className={css.block}>
          <h4>{t('verification')} · {verification.verdict === 'passed' ? t('verdictPassed') : t('verdictFailed')}</h4>
          <p>{verification.summary}</p>
          <h5>{t('commands')}</h5>
          <CommandEvidence commands={verification.commands} t={t} />
        </div>
      )}
      {review !== undefined && (
        <div className={css.block}>
          <h4>{t('review')} · {review.verdict === 'passed' ? t('verdictPassed') : t('verdictRejected')}</h4>
          <p>{review.summary}</p>
          <dl className={css.evidence}>
            <EvidenceRow label={t('reviewRound')}>{review.round}</EvidenceRow>
            <EvidenceRow label={t('specRevision')}>{review.specRevision}</EvidenceRow>
            <EvidenceRow label={t('reviewerSession')}>{shortId(review.reviewerSessionId)}</EvidenceRow>
            <EvidenceRow label={t('verificationId')}>{review.verificationId}</EvidenceRow>
          </dl>
          <h5>{t('issues')}</h5>
          <IssueEvidence issues={review.issues} t={t} />
        </div>
      )}
    </section>
  )
}

function ProjectionNotice({ kind, t }: { kind: 'loading' | 'reconnecting' | 'unavailable'; t: CrewDetailsViewProps['t'] }) {
  return <div className={css.notice} role="status">{t(kind)}</div>
}

/** Render the live Crew projection without exposing child navigation or input. */
export function CrewDetailsView({
  matched, useProjection, useSession, closeDetails, openDetails, t,
  useActivity, observeWorker, loadOlderActivity,
}: CrewDetailsViewProps) {
  const state = useProjection('crew')
  const manager = useSession(snapshot => snapshot.subagent === null)
  const openState = useSession(snapshot => snapshot.openState)
  const active = state?.workItems.filter(item => !terminal(item.stage)) ?? []
  const completed = state?.workItems.filter(item => terminal(item.stage)) ?? []
  const selected = state?.workItems.find(item => item.taskId === matched.taskId)
    ?? active[0]
    ?? completed[0]
  const integration = state?.integrations.at(-1)
  const commit = state?.commits.at(-1)
  const workerSessionId = matched.workerSessionId
    ?? (selected?.stage === 'reviewing' ? selected.reviewerSessionId : selected?.developerSessionId)

  let body: ReactNode
  if (!manager) {
    body = <ProjectionNotice kind="unavailable" t={t} />
  } else if (state === undefined) {
    body = <ProjectionNotice kind={openState === 'loading' ? 'loading' : openState === 'cold' ? 'reconnecting' : 'unavailable'} t={t} />
  } else if (state.failure !== undefined) {
    body = <div className={css.error} role="alert">{t('failedProjection')}: {state.failure}</div>
  } else if (!state.configured && state.workItems.length === 0) {
    body = <div className={css.notice}>{t('empty')}</div>
  } else {
    body = (
      <>
        <section className={css.summary} aria-label={t('project')}>
          <div><span>{t('manager')}</span><strong>{managerStatus(state, t)}</strong></div>
          <div><span>{t('repository')}</span><strong>{state.repositoryRoot ?? '—'}</strong></div>
        </section>
        <section className={css.group}>
          <h2>{t('active')} <span>{active.length}</span></h2>
          {active.length === 0
            ? <div className={css.notice}>{t('noActive')}</div>
            : <div className={css.workers}>{active.map(item => (
              <WorkerRow
                key={item.taskId}
                item={item}
                selected={selected?.taskId === item.taskId}
                select={() => { openDetails({ kind: 'crew', taskId: item.taskId }) }}
                t={t}
              />
            ))}</div>}
        </section>
        <section className={css.group}>
          <h2>{t('completed')} <span>{completed.length}</span></h2>
          {completed.length === 0
            ? <div className={css.notice}>{t('noCompleted')}</div>
            : <div className={css.workers}>{completed.map(item => (
              <WorkerRow
                key={item.taskId}
                item={item}
                selected={selected?.taskId === item.taskId}
                select={() => { openDetails({ kind: 'crew', taskId: item.taskId }) }}
                t={t}
              />
            ))}</div>}
        </section>
        {selected !== undefined && <>
          <section className={css.group} aria-label={t('activitySelect')}>
            <div className={css.workers}>
              {[...new Set([
                selected.developerSessionId, selected.reviewerSessionId, ...selected.workerSessionIds,
              ])].filter(id => id !== undefined).map(id => <button key={id} type="button"
                className={css.worker} aria-pressed={workerSessionId === id}
                onClick={() => { openDetails({ kind: 'crew', taskId: selected.taskId, workerSessionId: id }) }}>
                {t(id === selected.developerSessionId ? 'developer' : id === selected.reviewerSessionId ? 'reviewer' : 'activityHistory')} · {shortId(id)}
              </button>)}
            </div>
          </section>
        </>}
        <WorkerActivity sessionId={workerSessionId} t={t} useActivity={useActivity}
          observeWorker={observeWorker} loadOlderActivity={loadOlderActivity} />
        {selected !== undefined && <WorkItemEvidence state={state} item={selected} t={t} />}
        <section className={css.card} aria-label={t('integration')}>
          <h3>{t('integration')}</h3>
          {integration === undefined
            ? <p>{t('none')}</p>
            : (
              <>
                <p>{t(integrationStatusKey(integration.status))} · {integration.summary}</p>
                <button type="button" className={css.worker}
                  aria-pressed={workerSessionId === integration.integratorSessionId}
                  onClick={() => { openDetails({ kind: 'crew', workerSessionId: integration.integratorSessionId }) }}>
                  {t('integrator')} · {t('activity')}
                </button>
                <dl className={css.evidence}>
                  <EvidenceRow label={t('integrationId')}>{integration.id}</EvidenceRow>
                  <EvidenceRow label={t('integratorSession')}>{shortId(integration.integratorSessionId)}</EvidenceRow>
                  <EvidenceRow label={t('approvedPaths')}>
                    {integration.approvedPaths === undefined
                      ? t('notRecorded')
                      : <List values={integration.approvedPaths} empty={t('none')} />}
                  </EvidenceRow>
                </dl>
                <details className={css.command}>
                  <summary>{t('integrationInputs')}</summary>
                  {integration.inputs.length === 0
                    ? <p>{t('none')}</p>
                    : <ul className={css.values}>{integration.inputs.map(input => (
                      <li key={input.taskId}>
                        <dl className={css.evidence}>
                          <EvidenceRow label={t('task')}>{input.taskId}</EvidenceRow>
                          <EvidenceRow label={t('workItemRevision')}>{input.workItemRevision}</EvidenceRow>
                          <EvidenceRow label={t('verificationId')}>{input.verificationId}</EvidenceRow>
                          <EvidenceRow label={t('reviewId')}>{input.reviewId}</EvidenceRow>
                        </dl>
                      </li>
                    ))}</ul>}
                </details>
                <div className={css.block}>
                  <h4>{t('commands')}</h4>
                  <CommandEvidence commands={integration.commands} t={t} />
                </div>
                <div className={css.block}>
                  <h4>{t('issues')}</h4>
                  <IssueEvidence issues={integration.issues} t={t} />
                </div>
              </>
            )}
        </section>
        <section className={css.card} aria-label={t('commit')}>
          <h3>{t('commit')}</h3>
          {commit === undefined
            ? <p>{t('noCommit')}</p>
            : (
              <>
                <p>{commit.status === 'committed' ? t('commitCommitted') : t('commitRejected')} · {commit.message}</p>
                <dl className={css.evidence}>
                  <EvidenceRow label={t('approvalId')}>{commit.approvalCallId}</EvidenceRow>
                  <EvidenceRow label={t('integrationId')}>{commit.integrationId}</EvidenceRow>
                  <EvidenceRow label={t('commitPaths')}><List values={commit.stagedPaths} empty={t('none')} /></EvidenceRow>
                  {commit.status === 'committed'
                    ? <EvidenceRow label={t('commitHash')}>{commit.commitHash ?? t('notRecorded')}</EvidenceRow>
                    : <EvidenceRow label={t('reason')}>{commit.reason ?? t('notRecorded')}</EvidenceRow>}
                </dl>
              </>
            )}
        </section>
      </>
    )
  }

  return (
    <div className={css.root} data-crew-details>
      <div className={css.header}>
        <div className={css.title}>{t('title')}</div>
        <button type="button" className={css.close} aria-label={t('close')} onClick={closeDetails}>
          <IconCloseOutline16 size={14} />
        </button>
      </div>
      <div className={css.body}>{body}</div>
    </div>
  )
}
