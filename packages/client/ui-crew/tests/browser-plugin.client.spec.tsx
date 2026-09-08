// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { DetailsViewOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { TeamTaskId } from '@deepseek-ai/dsh-agent-team/client'
import type { CrewProjectionView, CrewStage } from '@deepseek-ai/dsh-crew/client'
import { CrewAction, type CrewActionInjected, type CrewActionProps } from '../src/client/CrewAction.tsx'
import { CrewDetailsView, type CrewDetailsViewProps } from '../src/client/CrewDetailsView.tsx'
import { CrewSettings } from '../src/client/CrewSettings.tsx'
import { catalog, preferencesFixture } from './preferences.fixture.client.ts'
import { en, zh, type CrewKey } from '../src/client/locales.ts'
import { apply, inject } from '../src/client/mount.ts'
import { apply as nodeApply } from '../src/index.ts'

const MANAGER = 'manager-session' as SessionId
const TASK = 'task-active' as TeamTaskId
const COMPLETE = 'task-complete' as TeamTaskId

const projection = {
  configured: true,
  repositoryRoot: 'C:/repo',
  workItems: [{
    taskId: TASK,
    revision: 3,
    moduleKey: 'auth',
    specPath: 'specs/auth.md',
    specRevision: 2,
    readScopes: ['packages/auth'],
    writeScopes: ['packages/auth'],
    requiredArtifacts: ['packages/auth/src/index.ts'],
    testCommands: [],
    baseline: {
      head: 'abc', statusDigest: 'clean', changedPaths: [], stagedPaths: [], pathDigests: {},
    },
    stage: 'reviewing',
    reason: 'awaiting independent review',
    developerSessionId: 'developer-session-long' as SessionId,
    reviewerSessionId: 'reviewer-session-long' as SessionId,
    workerSessionIds: [],
    attempt: 1,
    automaticRepairCount: 0,
    reviewRound: 1,
    latestReportId: 'report-1',
    latestVerificationId: 'verification-1',
    latestReviewId: 'review-1',
  }, {
    taskId: COMPLETE,
    revision: 5,
    moduleKey: 'docs',
    specPath: 'specs/docs.md',
    specRevision: 1,
    readScopes: ['docs'],
    writeScopes: ['docs'],
    requiredArtifacts: ['docs/readme.md'],
    testCommands: [],
    baseline: {
      head: 'abc', statusDigest: 'clean', changedPaths: [], stagedPaths: [], pathDigests: {},
    },
    stage: 'accepted',
    developerSessionId: 'docs-worker' as SessionId,
    workerSessionIds: [],
    attempt: 1,
    automaticRepairCount: 0,
    reviewRound: 1,
  }],
  reports: [{
    id: 'report-1', taskId: TASK, workItemRevision: 2, role: 'developer',
    workerSessionId: 'developer-session-long' as SessionId, specRevision: 2,
    verdict: 'ready', summary: 'Implemented auth flow.', changedPaths: ['packages/auth/src/index.ts'], issues: [],
  }],
  verifications: [{
    id: 'verification-1', taskId: TASK, reportId: 'report-1',
    workerSessionId: 'developer-session-long' as SessionId, specRevision: 2,
    startedAt: 1, finishedAt: 2, workerStopReason: 'completed',
    checkout: { head: 'abc', statusDigest: 'module-state', changedPaths: [], stagedPaths: [], pathDigests: {} },
    changedPaths: ['packages/auth/src/index.ts'], outOfScopePaths: [], missingArtifacts: [],
    commands: [{
      commandId: 'unit', argv: ['pnpm', 'test', 'auth'], cwd: 'C:/repo', exitCode: 0,
      signal: null, timedOut: false, stdout: 'ok', stderr: '', stdoutTruncated: false, stderrTruncated: false,
    }], verdict: 'passed', summary: 'Host checks passed.',
  }],
  reviews: [{
    id: 'review-1', taskId: TASK, reportId: 'report-1',
    reviewerSessionId: 'reviewer-session-long' as SessionId, specRevision: 2,
    verificationId: 'verification-1', round: 1, verdict: 'rejected',
    issues: [{ path: 'packages/auth/src/index.ts', line: 12, message: 'Handle expiry.', expected: 'Reject expired tokens.' }],
    summary: 'One issue remains.', stopReason: 'completed',
  }],
  integrations: [{
    id: 'integration-1', revision: 2, status: 'passed',
    inputCheckout: { head: 'abc', statusDigest: 'module-state', changedPaths: [], stagedPaths: [], pathDigests: {} },
    integratorSessionId: 'integrator-session' as SessionId, inputs: [], testCommands: [], commands: [], issues: [],
    summary: 'Combined verification passed.', approvedPaths: ['packages/auth/src/index.ts'],
  }],
  notifications: [],
  commits: [{
    id: 'commit-1', integrationId: 'integration-1', approvalCallId: 'approval-call-long',
    stagedPaths: ['packages/auth/src/index.ts'], message: 'feat: auth', status: 'committed', commitHash: 'def',
  }],
} as unknown as CrewProjectionView

function t(key: Parameters<CrewActionProps['t']>[0]): string {
  return key in en ? en[key as CrewKey] : key
}

function actionProps(options: { manager?: boolean; state?: CrewProjectionView } = {}): CrewActionProps {
  return {
    t,
    openCrew: vi.fn(),
    useProjection: (() => options.state ?? projection) as CrewActionProps['useProjection'],
    useSession: ((selector: (value: object) => unknown) => selector({
      subagent: options.manager === false ? { address: {} } : null,
    })) as CrewActionProps['useSession'],
  } as unknown as CrewActionProps
}

function detailsProps(options: {
  manager?: boolean
  state?: CrewProjectionView | undefined
  openState?: 'cold' | 'loading' | 'ready' | 'error'
  taskId?: TeamTaskId
} = {}): CrewDetailsViewProps {
  return {
    t,
    matched: options.taskId === undefined ? { kind: 'crew' } : { kind: 'crew', taskId: options.taskId },
    closeDetails: vi.fn(),
    openDetails: vi.fn(),
    observeWorker: vi.fn(() => () => {}),
    loadOlderActivity: vi.fn(),
    useActivity: (selector: (value: object) => unknown) => selector({
      sessionId: undefined, status: 'idle', nodes: [], hasMore: false,
    }),
    useProjection: (() => Object.hasOwn(options, 'state') ? options.state : projection) as CrewDetailsViewProps['useProjection'],
    useSession: ((selector: (value: object) => unknown) => selector({
      subagent: options.manager === false ? { address: {} } : null,
      openState: options.openState ?? 'ready',
    })) as CrewDetailsViewProps['useSession'],
  } as unknown as CrewDetailsViewProps
}

describe('Crew browser UI', () => {
  afterEach(cleanup)

  it('shows a live manager trigger and hides it in child Sessions', () => {
    const manager = actionProps()
    const view = render(<CrewAction {...manager} />)
    expect(screen.getByRole('button', { name: en.open }).textContent).toContain('1')
    fireEvent.click(screen.getByRole('button', { name: en.open }))
    expect(manager.openCrew).toHaveBeenCalledWith({ kind: 'crew' })

    view.rerender(<CrewAction {...actionProps({ manager: false })} />)
    expect(screen.queryByRole('button', { name: en.open })).toBeNull()
  })

  it('renders immutable worker, verification, review, integration, and commit evidence', () => {
    const props = detailsProps()
    render(<CrewDetailsView {...props} />)

    expect(screen.getAllByText('C:/repo').length).toBeGreaterThan(0)
    expect(screen.getByText('Implemented auth flow.')).toBeTruthy()
    expect(screen.getByText('pnpm test auth')).toBeTruthy()
    expect(screen.getByText('packages/auth/src/index.ts:12 · Handle expiry.')).toBeTruthy()
    expect(screen.getByText(/Combined verification passed/)).toBeTruthy()
    expect(screen.getByText(/feat: auth/)).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /docs/i }))
    expect(props.openDetails).toHaveBeenCalledWith({ kind: 'crew', taskId: COMPLETE })
    fireEvent.click(screen.getByRole('button', { name: en.close }))
    expect(props.closeDetails).toHaveBeenCalledOnce()
  })

  it('contains the projection for child Sessions and reports loading and replay failures', () => {
    const child = render(<CrewDetailsView {...detailsProps({ manager: false })} />)
    expect(screen.getByRole('status').textContent).toBe(en.unavailable)

    child.rerender(<CrewDetailsView {...detailsProps({ state: undefined, openState: 'loading' })} />)
    expect(screen.getByRole('status').textContent).toBe(en.loading)

    child.rerender(<CrewDetailsView {...detailsProps({ state: { ...projection, failure: 'invalid event' } })} />)
    expect(screen.getByRole('alert').textContent).toContain('invalid event')
  })

  it.each([
    { language: 'English', dictionary: en, stdout: 'Standard output', stderr: 'Standard error',
      exit: 'Exit code', signal: 'Signal', timeout: 'Timed out', yes: 'Yes',
      truncation: 'Output was truncated by the host.' },
    { language: 'Chinese', dictionary: zh, stdout: '标准输出', stderr: '标准错误',
      exit: '退出码', signal: '信号', timeout: '已超时', yes: '是',
      truncation: '输出已被宿主截断。' },
  ])('shows read-only logs and independent process outcomes in $language', (copy) => {
    const stdout = '<img src="canary" onerror="throw 1">\nfirst column\tsecond column'
    const stderr = 'diagnostic: command stopped early'
    const state: CrewProjectionView = {
      ...projection,
      verifications: projection.verifications.map(verification => ({
        ...verification,
        commands: verification.commands.map(command => ({
          ...command, exitCode: 0, signal: 'SIGTERM', timedOut: true,
          stdout, stderr, stdoutTruncated: true, stderrTruncated: true,
        })),
      })),
    }
    const original = JSON.stringify(state)
    const view = render(<CrewDetailsView {...detailsProps({ state })}
      t={key => key in copy.dictionary ? copy.dictionary[key as CrewKey] : key}
    />)
    const summary = screen.getByText('pnpm test auth').closest('summary')
    expect(summary).not.toBeNull()
    fireEvent.click(summary!)
    const details = within(summary!.parentElement!)
    expect(details.getByText(copy.exit).nextElementSibling?.textContent).toBe('0')
    expect(details.getByText(copy.signal).nextElementSibling?.textContent).toBe('SIGTERM')
    expect(details.getByText(copy.timeout).nextElementSibling?.textContent).toBe(copy.yes)
    expect(details.getByRole('region', { name: copy.stdout }).textContent).toBe(stdout)
    expect(details.getByRole('region', { name: copy.stderr }).textContent).toBe(stderr)
    expect(details.getAllByText(copy.truncation)).toHaveLength(2)
    expect(view.container.querySelector('img, script, input, textarea, [contenteditable]')).toBeNull()
    expect(JSON.stringify(state)).toBe(original)
  })

  it('exposes integration command logs without inventing an exit code or empty output', () => {
    const state: CrewProjectionView = {
      ...projection,
      integrations: projection.integrations.map(integration => ({
        ...integration,
        commands: [{
          commandId: 'integration', argv: ['node', '--test', 'combined.test.mjs'],
          cwd: 'C:/repo/modules', exitCode: null, signal: null, timedOut: false,
          stdout: '', stderr: 'Unable to start the command.', stdoutTruncated: false, stderrTruncated: false,
        }],
      })),
    }
    render(<CrewDetailsView {...detailsProps({ state })} />)
    const summary = screen.getByText('node --test combined.test.mjs').closest('summary')!
    fireEvent.click(summary)
    const details = within(summary.parentElement!)
    expect(details.getByText('Working directory').nextElementSibling?.textContent).toBe('C:/repo/modules')
    expect(details.getByText('Exit code').nextElementSibling?.textContent).toBe('Not recorded')
    expect(details.getByText('Signal').nextElementSibling?.textContent).toBe('None')
    expect(details.getByText('Timed out').nextElementSibling?.textContent).toBe('No')
    expect(details.getByText('No output')).toBeTruthy()
    expect(details.queryByRole('region', { name: 'Standard output' })).toBeNull()
    expect(details.getByRole('region', { name: 'Standard error' }).textContent).toBe('Unable to start the command.')
    expect(details.queryByText('Output was truncated by the host.')).toBeNull()
  })

  it('distinguishes reconnecting and empty projections and recovers a stale worker selection', () => {
    const view = render(<CrewDetailsView {...detailsProps({ state: undefined, openState: 'cold' })} />)
    expect(screen.getByRole('status').textContent).toBe(en.reconnecting)

    view.rerender(<CrewDetailsView {...detailsProps({ state: {
      ...projection,
      configured: false,
      workItems: [],
    } })} />)
    expect(screen.getByText(en.empty)).toBeTruthy()

    view.rerender(<CrewDetailsView {...detailsProps({ taskId: 'stale-task' as TeamTaskId })} />)
    expect(within(view.container).getByRole('button', { name: /auth/i }).getAttribute('aria-pressed')).toBe('true')
  })

  it.each([
    ['planned', en.managerWorking], ['queued', en.managerWorking], ['running', en.managerWorking],
    ['verifying', en.managerWorking], ['reviewing', en.managerWorking], ['revision_required', en.managerAttention],
    ['integration_ready', en.managerWorking], ['accepted', en.managerIdle], ['paused', en.managerAttention],
    ['failed', en.managerAttention], ['cancelled', en.managerIdle],
  ] satisfies [CrewStage, string][])('labels %s work and manager attention without relying on color', (stage, manager) => {
    const { developerSessionId: _developer, reviewerSessionId: _reviewer, ...item } = projection.workItems[0]!
    const state: CrewProjectionView = {
      ...projection, workItems: [{ ...item, stage }],
      reports: [], verifications: [], reviews: [], integrations: [], commits: [],
    }
    const props = detailsProps({ state, taskId: TASK })
    render(<CrewDetailsView {...props} />)
    expect(screen.getByText(manager)).toBeTruthy()
    const worker = screen.getByRole('button', { name: new RegExp(en[`stage.${stage}`], 'u') })
    expect(worker.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(en.session).nextElementSibling?.textContent).toBe('—')
    expect(screen.getByText(en.noCommit)).toBeTruthy()
    fireEvent.click(worker)
    expect(props.openDetails).toHaveBeenCalledWith({ kind: 'crew', taskId: TASK })
  })

  it.each([
    ['running', en.statusRunning], ['passed', en.statusPassed],
    ['failed', en.statusFailed], ['cancelled', en.statusCancelled],
  ] as const)('labels a recorded %s integration independently of its commands', (status, label) => {
    const state: CrewProjectionView = {
      ...projection, integrations: projection.integrations.map(item => ({ ...item, status, summary: 'Integration result recorded.' })),
    }
    render(<CrewDetailsView {...detailsProps({ state })} />)
    const card = within(screen.getByRole('heading', { name: en.integration }).parentElement!)
    expect(card.getByText(`${label} · Integration result recorded.`)).toBeTruthy()
    expect(card.getByRole('heading', { name: en.commands }).nextElementSibling?.textContent).toBe(en.none)
  })

  it('distinguishes unavailable projections and a configured project without workers', () => {
    const view = render(<CrewDetailsView {...detailsProps({ state: undefined, openState: 'ready' })} />)
    expect(screen.getByRole('status').textContent).toBe(en.unavailable)
    const { repositoryRoot: _root, ...state } = projection
    view.rerender(<CrewDetailsView {...detailsProps({ state: { ...state, workItems: [] } })} />)
    expect(screen.getByText(en.managerIdle)).toBeTruthy()
    expect(screen.getByText(en.noActive)).toBeTruthy()
    expect(screen.getByText(en.noCompleted)).toBeTruthy()
    expect(screen.getByText(en.repository).nextElementSibling?.textContent).toBe('—')
  })

  it('keeps a selected finished worker readable when no reason was recorded', () => {
    render(<CrewDetailsView {...detailsProps({ taskId: COMPLETE })} />)
    expect(screen.getByRole('button', { name: /docs/u }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(en.reason).nextElementSibling?.textContent).toBe(en.none)
    expect(screen.getByText(en.role).nextElementSibling?.textContent).toBe(en.developer)
  })

  it.each([
    { language: 'English', dictionary: en, round: 'Review round', spec: 'Specification revision',
      verification: 'Verification record', expected: 'Expected correction', inputs: 'Included work items',
      paths: 'Requested commit paths', hash: 'Commit hash' },
    { language: 'Chinese', dictionary: zh, round: '审查轮次', spec: '规格修订',
      verification: '验证记录', expected: '预期修正', inputs: '包含的工单',
      paths: '请求提交路径', hash: '提交哈希' },
  ])('exposes review, integration, and rejected commit evidence in $language', (copy) => {
    const reason = 'Checkout changed after the passing integration.'
    const state: CrewProjectionView = {
      ...projection,
      integrations: projection.integrations.map(integration => ({
        ...integration, status: 'failed', summary: 'Combined checks found an interface mismatch.',
        inputs: [{ taskId: TASK, workItemRevision: 3,
          verificationId: projection.verifications[0]!.id, reviewId: projection.reviews[0]!.id }],
        issues: [{ path: 'packages/auth/src/index.ts', message: 'Different return type.', expected: 'Return a token object.' }],
      })),
      commits: projection.commits.map(({ commitHash: _hash, ...commit }) => ({ ...commit, status: 'rejected', reason })),
    }
    render(<CrewDetailsView {...detailsProps({ state })}
      t={key => key in copy.dictionary ? copy.dictionary[key as CrewKey] : key}
    />)
    expect(screen.getByText(copy.round).nextElementSibling?.textContent).toBe('1')
    expect(screen.getByText(copy.spec).nextElementSibling?.textContent).toBe('2')
    expect(screen.getAllByText(copy.verification).length).toBeGreaterThan(0)
    expect(screen.getByText('Reject expired tokens.')).toBeTruthy()
    expect(screen.getByText('Return a token object.')).toBeTruthy()
    expect(screen.getAllByText(copy.expected)).toHaveLength(2)
    expect(screen.getByText(copy.inputs)).toBeTruthy()
    expect(screen.getByText(TASK)).toBeTruthy()
    expect(screen.getByText(copy.paths)).toBeTruthy()
    expect(screen.getByText(reason)).toBeTruthy()
    expect(screen.getByText('approval-call-long')).toBeTruthy()
    expect(screen.queryByText(copy.hash)).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('shows the complete recorded commit identity without a new approval action', () => {
    render(<CrewDetailsView {...detailsProps()} />)
    expect(screen.getByText('Commit hash').nextElementSibling?.textContent).toBe('def')
    expect(screen.getByText('Approval call').nextElementSibling?.textContent).toBe('approval-call-long')
    expect(screen.queryByRole('button', { name: /approve|commit/u })).toBeNull()
  })

  it('does not invent optional projection evidence when it is absent', () => {
    const state: CrewProjectionView = {
      ...projection,
      integrations: projection.integrations.map(({ approvedPaths: _paths, ...integration }) => integration),
      commits: projection.commits.map(({ commitHash: _hash, ...commit }) => commit),
    }
    render(<CrewDetailsView {...detailsProps({ state })} />)
    const integration = within(screen.getByRole('region', { name: en.integration }))
    const commit = within(screen.getByRole('region', { name: en.commit }))
    expect(integration.getByText(en.approvedPaths).nextElementSibling?.textContent).toBe(en.notRecorded)
    expect(commit.getByText(en.commitHash).nextElementSibling?.textContent).toBe(en.notRecorded)
  })

  it('shows failed verification paths, passing review without line numbers, and commit rejection', () => {
    const state: CrewProjectionView = {
      ...projection,
      workItems: projection.workItems.map(item => ({ ...item, reviewerSessionId: 'reviewer' as SessionId })),
      verifications: projection.verifications.map(item => ({
        ...item, verdict: 'failed', outOfScopePaths: ['outside.ts'], missingArtifacts: ['missing.ts'],
      })),
      reviews: projection.reviews.map(item => ({
        ...item, verdict: 'passed', issues: [{ path: 'file.ts', message: 'Check expiry.', expected: 'Reject old tokens.' }],
      })),
      commits: projection.commits.map(({ commitHash: _hash, ...item }) => ({ ...item, status: 'rejected' })),
    }
    render(<CrewDetailsView {...detailsProps({ state })} />)
    expect(screen.getByText(`${en.verification} · ${en.verdictFailed}`)).toBeTruthy()
    expect(screen.getByText('outside.ts')).toBeTruthy()
    expect(screen.getByText('missing.ts')).toBeTruthy()
    expect(screen.getByText(`${en.review} · ${en.verdictPassed}`)).toBeTruthy()
    expect(screen.getByText('file.ts · Check expiry.')).toBeTruthy()
    expect(screen.getByText(en.session).nextElementSibling?.textContent).toBe('reviewer')
    expect(screen.getByText(`${en.commitRejected} · feat: auth`)).toBeTruthy()
  })

  it('registers disposable header and details-chain entries', async () => {
    const ctx = new Context()
    const open = vi.fn()
    ctx.provide('chatDetails', { open })
    ctx.provide('sessions', {})
    ctx.provide('uiConversation', {})
    ctx.provide('settingsScope', { bind: () => preferencesFixture().scope })
    ctx.provide('remote', { $on: vi.fn(() => () => {}), session: { modelCatalog: async () => ({ ok: true, value: catalog }) } })
    ctx.provide('remote.session', { modelCatalog: async () => ({ ok: true, value: catalog }) })
    ctx.provide('locale', new LocaleRuntime(ctx))
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({
      name: 'root',
      children: {
        'conversation.session.header.actions': { kind: 'list', scope: 'session' },
        'conversation.details.view': { kind: 'chain', scope: 'session' },
        'settings.section': { kind: 'list', scope: 'root' },
      },
    } as never, () => null)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const header = ctx.slots.entries('conversation.session.header.actions')
      .find(entry => entry.component === CrewAction)!
    const details = ctx.slots.entries('conversation.details.view')
      .find(entry => entry.component === CrewDetailsView)!
    expect(inject).toEqual(['slots', 'locale', 'chatDetails', 'settingsScope', 'remote', 'remote.session', 'sessions', 'uiConversation'])
    expect(ctx.slots.entries('settings.section').some(entry => entry.component === CrewSettings)).toBe(true)
    expect(header.options).toMatchObject({ id: 'crew', order: 15 })
    const select = details.select as unknown as (owner: DetailsViewOwnerProps) => unknown
    expect(select({ selection: { kind: 'crew', taskId: TASK } } as DetailsViewOwnerProps)).toEqual({
      kind: 'crew', taskId: TASK,
    })
    expect(select({ selection: { kind: 'tool', callId: 'call' } } as DetailsViewOwnerProps)).toBeNull()
    const actions = (header.inject as unknown as (sessionId: SessionId) => CrewActionInjected)(MANAGER)
    actions.openCrew({ kind: 'crew', taskId: TASK })
    expect(open).toHaveBeenCalledWith(MANAGER, { kind: 'crew', taskId: TASK })

    await fiber.dispose()
    expect(ctx.slots.entries('conversation.session.header.actions')).toHaveLength(0)
    expect(ctx.slots.entries('conversation.details.view')).toHaveLength(0)
    expect(ctx.slots.entries('settings.section')).toHaveLength(0)
  })

  it('keeps the host half inert', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
