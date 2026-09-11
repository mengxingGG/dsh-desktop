/** Native Crew service over Agent Teams tasks and manager Session events. */

import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-cmdline'
import { brandString } from '@deepseek-ai/dsh-brand'
import { MessageId, freezeMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import { carrierKeyOf, type Scoped } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { finalAssistantOutput, SubagentRunId } from '@deepseek-ai/dsh-subagent'
import type { SubagentRunEndInfo, SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import { steerHostSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { TeamMembership, TeamTaskView } from '@deepseek-ai/dsh-agent-team'
import type {} from './preferences.ts'
import { CrewError } from './error.ts'
import { CrewHost } from './host.ts'
import { approvedCrewCommit } from './internal.ts'
import { CrewJournal } from './journal.ts'
import { CrewWorkspace } from './path-policy.ts'
import { crewProjectionDefinition } from './projection.ts'
import {
  crewCheckout,
  crewCommand,
  crewKey,
  crewScopesOverlap,
  crewText,
  crewTimerDuration,
  nonNegativeSafeInteger,
  positiveSafeInteger,
  pathInCrewScope,
  repositoryPath,
} from './validation.ts'
import { canTransitionCrewStage } from './transition.ts'
import { installRequestLimits } from './request-limits.ts'
import type {
  Config,
  CreateCrewWorkItemRequest,
  CrewConfigurationSnapshot,
  CrewAgentOptionsSnapshot,
  AppendCrewWorkRequest,
  CommitCrewRequest,
  CrewFileEntry,
  CrewFileRead,
  CrewCheckoutSnapshot,
  CrewCommandResult,
  CrewCommitId,
  CrewCommitSnapshot,
  DispatchCrewWorkRequest,
  IntegrateCrewRequest,
  RecordCrewReportRequest,
  ReassignCrewWorkRequest,
  StopCrewWorkRequest,
  CrewMutationResult,
  CrewNotificationId,
  CrewNotificationSnapshot,
  CrewProjectionState,
  CrewReportSnapshot,
  CrewReportId,
  CrewReviewId,
  CrewReviewSnapshot,
  CrewIntegrationId,
  CrewIntegrationSnapshot,
  CrewRolePresetSnapshot,
  CrewStage,
  CrewView,
  CrewWorkerRole,
  CrewWorkerBinding,
  CrewWorkerMessageSource,
  CrewTestRun,
  CrewVerificationId,
  CrewVerificationSnapshot,
  CrewWorkItemSnapshot,
  UpdateCrewWorkItemRequest,
} from './types.ts'

type RecoveryBinding =
  | { readonly role: 'developer' | 'reviewer'; readonly taskId: CrewWorkItemSnapshot['taskId']; readonly revision: number }
  | { readonly role: 'integrator'; readonly integrationId: CrewIntegrationId; readonly revision: number }

interface CrewWorkerAccessBase {
  readonly root: Agent
  readonly configuration: CrewConfigurationSnapshot
  readonly readScopes: string[] | undefined
  readonly writeScopes: string[] | undefined
}

type CrewWorkerAccess = CrewWorkerAccessBase & (
  | {
    readonly binding: Extract<CrewWorkerBinding, { role: 'developer' | 'reviewer' }>
    readonly workItem: CrewWorkItemSnapshot
  }
  | {
    readonly binding: Extract<CrewWorkerBinding, { role: 'integrator' }>
    readonly workItem?: never
  }
)

export type * from './types.ts'
export type { CrewErrorCode } from './error.ts'
export { CrewError } from './error.ts'
export {
  CrewCommitId,
  CrewIntegrationId,
  CrewNotificationId,
  CrewReportId,
  CrewReviewId,
  CrewVerificationId,
} from './types.ts'
export { canTransitionCrewStage, crewStageSuccessors } from './transition.ts'
export { CrewPreferences, CREW_PREFERENCES_NAMESPACE } from './preferences.ts'
export { CrewMemoryId } from './preferences-types.ts'
export type * from './preferences-types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    crew: CrewService
  }
}

const DEFAULT_DEVELOPER_PERSONA = 'You are a DSH-native development worker. Follow the assigned specification, use only Crew-scoped tools, record a structured Crew report, and never modify Git state.'
const DEFAULT_REVIEWER_PERSONA = 'You are an independent DSH-native reviewer. Read the complete project, check requirements, implementation and tests, and report concrete issues for the original developer to repair. Do not edit implementation files or Git state.'
const DEFAULT_INTEGRATOR_PERSONA = 'You are a DSH-native integrator. Read and modify project files to connect reviewed modules, run combined tests, and report every integration change. Preserve unrelated work and request manager guidance for changes beyond integration. Do not modify Git state.'

const DEFAULT_NATIVE_PROVIDER = 'spawn'
const DEFAULT_MAX_CONCURRENT_WORKERS = 2
const DEFAULT_MAX_CONCURRENT_REQUESTS = 2
const DEFAULT_NOTIFICATION_BATCH_WINDOW_MS = 250
const DEFAULT_WORKER_TURN_TIMEOUT_MS = 900_000
const DEFAULT_MAX_AUTOMATIC_REPAIRS = 0
const DEFAULT_MAX_REVIEW_ROUNDS = 2
const DEFAULT_ALLOWED_TEST_PROGRAMS = ['pnpm', 'npm', 'node']
const DEFAULT_SHARED_DIRECTORIES = ['docs', 'test', 'tests']
const DEFAULT_COMMIT_MESSAGE_MAX_LENGTH = 200
const DEFAULT_EXECUTION_LIMITS = {
  maxOutputBytes: 64 * 1024,
  processGraceMs: 5_000,
  gitTimeoutMs: 30_000,
  ignoredDirectories: ['node_modules', '.npm-cache', '.pnpm-store', 'dist', 'build', 'coverage', '.next'],
}
function rolePreset(
  role: CrewWorkerRole,
  defaults: { persona: string },
  override: Partial<Omit<CrewRolePresetSnapshot, 'role'>> | undefined,
): CrewRolePresetSnapshot {
  const maxDepth = nonNegativeSafeInteger(override?.maxDepth ?? 1, `${role} maxDepth`)
  const persona = override?.persona?.trim() ?? defaults.persona
  if (persona.length === 0) throw new CrewError(`${role} persona must not be empty`, 'CREW_INVALID_CONFIG')
  // Role tools are registered on the exact child scope by tool-crew and are
  // therefore exempt from inherited-tool filtering. An empty allow-list strips
  // every inherited capability before those exact scoped tools are installed.
  const toolFilter: ToolRestriction = structuredClone(override?.toolFilter ?? { allow: [] })
  if (toolFilter.allow === undefined && toolFilter.deny === undefined) {
    throw new CrewError(`${role} toolFilter must declare allow and/or deny`, 'CREW_INVALID_CONFIG')
  }
  const agentOptions: CrewAgentOptionsSnapshot = structuredClone(override?.agentOptions ?? {})
  return { role, persona, toolFilter, agentOptions, maxDepth }
}

function workItemActive(stage: CrewStage): boolean {
  return ['planned', 'queued', 'running', 'verifying', 'reviewing'].includes(stage)
}

/** Native Crew service and DSH provider for the first-phase software workflow. */
export class CrewService extends TypertRemoteService {
  static inject = ['agentTeams', 'sessions', 'sessionProjections', 'subagents']

  static Config: z<Config> = z.object({
    repositoryRoot: z.string(),
    nativeProvider: z.string().default(DEFAULT_NATIVE_PROVIDER),
    maxConcurrentWorkers: z.number().step(1).min(1).default(DEFAULT_MAX_CONCURRENT_WORKERS),
    maxConcurrentRequests: z.number().step(1).min(1).default(DEFAULT_MAX_CONCURRENT_REQUESTS),
    providerRequestLimits: z.dict(z.number().step(1).min(1)),
    providerRequestGroups: z.dict(z.string()),
    notificationBatchWindowMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_NOTIFICATION_BATCH_WINDOW_MS),
    workerTurnTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_WORKER_TURN_TIMEOUT_MS),
    maxAutomaticRepairs: z.number().step(1).min(0).default(DEFAULT_MAX_AUTOMATIC_REPAIRS),
    maxReviewRounds: z.number().step(1).min(1).default(DEFAULT_MAX_REVIEW_ROUNDS),
    allowedTestPrograms: z.array(z.string()).default(DEFAULT_ALLOWED_TEST_PROGRAMS),
    sharedDirectories: z.array(z.string()).default(DEFAULT_SHARED_DIRECTORIES),
    execution: z.object({
      ignoredDirectories: z.array(z.string()),
      maxOutputBytes: z.number().step(1).min(1).default(DEFAULT_EXECUTION_LIMITS.maxOutputBytes),
      processGraceMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_EXECUTION_LIMITS.processGraceMs),
      gitTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_EXECUTION_LIMITS.gitTimeoutMs),
    }),
    commitPolicy: z.object({
      maxMessageLength: z.number().step(1).min(1).default(DEFAULT_COMMIT_MESSAGE_MAX_LENGTH),
      requireNamedBranch: z.boolean().default(true),
    }),
    roles: z.object({
      developer: z.object({
        persona: z.string(),
        toolFilter: z.object({ allow: z.array(z.string()), deny: z.array(z.string()) }),
        agentOptions: z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string() }),
        maxDepth: z.number().step(1).min(0),
      }),
      reviewer: z.object({
        persona: z.string(),
        toolFilter: z.object({ allow: z.array(z.string()), deny: z.array(z.string()) }),
        agentOptions: z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string() }),
        maxDepth: z.number().step(1).min(0),
      }),
      integrator: z.object({
        persona: z.string(),
        toolFilter: z.object({ allow: z.array(z.string()), deny: z.array(z.string()) }),
        agentOptions: z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string() }),
        maxDepth: z.number().step(1).min(0),
      }),
    }),
  }) as unknown as z<Config>

  private readonly configuredRoot: string | undefined
  private readonly configurationDefaults: Omit<CrewConfigurationSnapshot, 'repositoryRoot'>
  private readonly journal: CrewJournal
  private readonly workspace: CrewWorkspace
  private readonly lifecycle = new AbortController()
  private readonly background = new Set<Promise<void>>()
  private readonly managerIntegrations = new Set<SessionId>()
  private readonly terminalEnds = new Map<SessionId, SubagentRunEndInfo>()
  private readonly terminalProcessing = new Set<SessionId>()
  private readonly terminalReschedule = new Set<SessionId>()
  private readonly intentionalStops = new Set<SessionId>()
  private readonly notificationBatches = new Map<SessionId, {
    readonly root: Agent
    readonly sourceSeqs: Set<SessionEvent['seq']>
    readonly timer: ReturnType<typeof setTimeout>
  }>()
  private readonly deliveringNotifications = new Set<SessionId>()
  private readonly recoveringRoots = new Set<SessionId>()
  private readonly recoveryRequested = new Set<SessionId>()
  private disposed = false

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'crew')
    this.configuredRoot = config.repositoryRoot === undefined ? undefined : resolve(config.repositoryRoot)
    const nativeProvider = config.nativeProvider?.trim() ?? DEFAULT_NATIVE_PROVIDER
    if (nativeProvider.length === 0) throw new CrewError('nativeProvider must not be empty', 'CREW_INVALID_CONFIG')
    const allowedTestPrograms = [...new Set(config.allowedTestPrograms ?? DEFAULT_ALLOWED_TEST_PROGRAMS)]
    if (allowedTestPrograms.length === 0 || allowedTestPrograms.some(program => program.trim().length === 0)) {
      throw new CrewError('allowedTestPrograms must contain at least one non-empty program', 'CREW_INVALID_CONFIG')
    }
    this.configurationDefaults = {
      nativeProvider,
      maxConcurrentWorkers: positiveSafeInteger(config.maxConcurrentWorkers ?? DEFAULT_MAX_CONCURRENT_WORKERS, 'maxConcurrentWorkers'),
      notificationBatchWindowMs: crewTimerDuration(config.notificationBatchWindowMs ?? DEFAULT_NOTIFICATION_BATCH_WINDOW_MS, 'notificationBatchWindowMs'),
      workerTurnTimeoutMs: crewTimerDuration(config.workerTurnTimeoutMs ?? DEFAULT_WORKER_TURN_TIMEOUT_MS, 'workerTurnTimeoutMs'),
      maxAutomaticRepairs: nonNegativeSafeInteger(config.maxAutomaticRepairs ?? DEFAULT_MAX_AUTOMATIC_REPAIRS, 'maxAutomaticRepairs'),
      maxReviewRounds: positiveSafeInteger(config.maxReviewRounds ?? DEFAULT_MAX_REVIEW_ROUNDS, 'maxReviewRounds'),
      allowedTestPrograms,
      sharedDirectories: (config.sharedDirectories ?? DEFAULT_SHARED_DIRECTORIES).map(path => repositoryPath(path, 'sharedDirectories')),
      execution: {
        ignoredDirectories: [...(config.execution?.ignoredDirectories ?? DEFAULT_EXECUTION_LIMITS.ignoredDirectories)],
        maxOutputBytes: positiveSafeInteger(config.execution?.maxOutputBytes ?? DEFAULT_EXECUTION_LIMITS.maxOutputBytes, 'execution.maxOutputBytes'),
        processGraceMs: crewTimerDuration(config.execution?.processGraceMs ?? DEFAULT_EXECUTION_LIMITS.processGraceMs, 'execution.processGraceMs'),
        gitTimeoutMs: crewTimerDuration(config.execution?.gitTimeoutMs ?? DEFAULT_EXECUTION_LIMITS.gitTimeoutMs, 'execution.gitTimeoutMs'),
      },
      commitPolicy: {
        maxMessageLength: positiveSafeInteger(
          config.commitPolicy?.maxMessageLength ?? DEFAULT_COMMIT_MESSAGE_MAX_LENGTH,
          'commitPolicy.maxMessageLength',
        ),
        requireNamedBranch: config.commitPolicy?.requireNamedBranch ?? true,
      },
      roles: {
        developer: rolePreset('developer', { persona: DEFAULT_DEVELOPER_PERSONA }, config.roles?.developer),
        reviewer: rolePreset('reviewer', { persona: DEFAULT_REVIEWER_PERSONA }, config.roles?.reviewer),
        integrator: rolePreset('integrator', { persona: DEFAULT_INTEGRATOR_PERSONA }, config.roles?.integrator),
      },
    }
    this.journal = new CrewJournal(ctx)
    this.workspace = new CrewWorkspace(ctx)
    installRequestLimits(ctx,
      positiveSafeInteger(config.maxConcurrentRequests ?? DEFAULT_MAX_CONCURRENT_REQUESTS, 'maxConcurrentRequests'),
      config.providerRequestLimits ?? {}, config.providerRequestGroups ?? {}, this.lifecycle.signal)
    ctx.on('app/active-work', () => this.background.size > 0 || this.notificationBatches.size > 0 ? true : undefined)
    ctx.effect(() => ctx.root.sessionProjections.register(crewProjectionDefinition), 'crew.projection()')
    const observeTerminal = (parent: Agent, info: SubagentRunEndInfo): void => { this.observeTerminal(parent, info) }
    ctx.on('subagent/settlement-notice', info => this.ownsWorker(info.parentSessionId, info.childSessionId) || undefined)
    ctx.on('subagent/end', function (this: Scoped<SubagentRuntime>, info) {
      observeTerminal(carrierKeyOf(this) as Agent, info)
    })
    ctx.on('agent/session-start', ({ agent }) => { this.scheduleRecovery(agent) })
    ctx.on('agent/status', ({ agent, status }) => {
      if (status === 'idle' && agent.session.header.parentSession === undefined) this.scheduleNotificationDelivery(agent)
    })
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'team/member') return
      if (event.data.member.phase === 'provisioning'
        || this.ctx.get('agents')?.get(event.data.member.id) !== undefined) return
      const root = this.ctx.get('agents')?.get(session.id)
      if (root !== undefined) this.scheduleRecovery(root)
    })
    let shutdown: Promise<void> | undefined
    const stop = (): Promise<void> => shutdown ??= (async () => {
      this.disposed = true
      this.lifecycle.abort(new CrewError('Crew service disposed', 'CREW_DISPOSED'))
      for (const batch of this.notificationBatches.values()) clearTimeout(batch.timer)
      this.notificationBatches.clear()
      await Promise.allSettled([...this.background])
    })()
    ctx.effect(() => stop, 'crew.runtime()')
    ctx.on('app/prepare-exit', stage => stage === 'producers' ? stop() : undefined)
  }

  /** Resolve and authorize one exact live Team Lead. */
  private lead(caller: Agent): TeamMembership & { role: 'lead' } {
    if (this.disposed) throw new CrewError('Crew service disposed', 'CREW_DISPOSED')
    const membership = this.ctx.agentTeams.membership(caller)
    if (membership.role !== 'lead') throw new CrewError('only the Team Lead can manage Crew workflow', 'CREW_LEAD_REQUIRED')
    return { ...membership, role: 'lead' }
  }

  /**
   * Persist immutable Crew configuration on first use and return it.
   * @param caller - Exact live Team Lead requesting Crew service.
   * @returns Existing or newly persisted Crew configuration.
   */
  async ensureConfigured(caller: Agent): Promise<CrewConfigurationSnapshot> {
    const { root, id } = this.lead(caller)
    return await this.journal.transact(root.id, async () => {
      const state = this.journal.state(root)
      if (state.configuration !== undefined) return structuredClone(state.configuration)
      const repositoryRoot = this.configuredRoot ?? root.session.header.cwd
      if (repositoryRoot === undefined) {
        throw new CrewError('Crew requires a repository root or a manager Session cwd', 'CREW_INVALID_CONFIG')
      }
      if (root.session.header.cwd === undefined || resolve(root.session.header.cwd) !== resolve(repositoryRoot)) {
        throw new CrewError('Crew repository root must equal the manager Session cwd', 'CREW_INVALID_CONFIG')
      }
      const configuration: CrewConfigurationSnapshot = {
        repositoryRoot: resolve(repositoryRoot),
        ...structuredClone(this.configurationDefaults),
      }
      await this.journal.appendAndFlush(root, 'crew/configuration', { version: 1, teamId: id, configuration })
      return structuredClone(configuration)
    })
  }

  /**
   * Create a Team task, freeze its checkout baseline, and start one native developer.
   * @param caller - Exact live Team Lead managing the workflow.
   * @param request - Module scope, specification, evidence, and cancellation request.
   * @returns Durable work item after native developer provisioning.
   */
  async dispatch(caller: Agent, request: DispatchCrewWorkRequest): Promise<CrewWorkItemSnapshot> {
    this.assertHostServices()
    const configuration = await this.ensureConfigured(caller)
    const { root } = this.lead(caller)
    if (this.managerIntegrations.has(root.id)) throw new CrewError('Manager verification is running', 'CREW_INVALID_TRANSITION')
    for (const blocker of request.blockedBy ?? []) {
      const task = this.ctx.agentTeams.getTask(root, blocker)
      if (task.status !== 'completed') {
        throw new CrewError(`Team task "${blocker}" is not completed`, 'CREW_TEAM_TASK_MISMATCH')
      }
    }
    const current = this.journal.state(root)
    const active = current.workItems.filter(item => workItemActive(item.stage)).length
    if (active >= configuration.maxConcurrentWorkers) {
      throw new CrewError(`Crew worker limit ${configuration.maxConcurrentWorkers} reached`, 'CREW_INVALID_TRANSITION')
    }
    const baseline = await this.host(configuration).inspectCheckout(configuration.repositoryRoot, this.operationSignal(request.signal))
    if (baseline.stagedPaths.length > 0) {
      throw new CrewError('Crew dispatch requires an unstaged checkout', 'CREW_CHECKOUT_DRIFT')
    }
    const task = await this.ctx.agentTeams.createTask(root, {
      subject: request.subject,
      description: request.description,
      ...request.blockedBy === undefined ? {} : { blockedBy: request.blockedBy },
      writeScopes: request.writeScopes,
    })
    let work: CrewWorkItemSnapshot
    try {
      work = await this.createWorkItem(root, { ...request, taskId: task.id, baseline })
    } catch (error: unknown) {
      try {
        await this.ctx.agentTeams.updateTask(root, {
          taskId: task.id,
          expectedRevision: task.revision,
          action: 'delete',
        })
      } catch (cleanupError: unknown) {
        throw new AggregateError([error, cleanupError], 'Crew task creation rollback failed')
      }
      throw error
    }
    return await this.provisionDeveloper(root, work, request.signal)
  }

  /**
   * Continue the current native developer without allocating a replacement child.
   * @param caller - Exact live Team Lead managing the workflow.
   * @param request - Current revision, follow-up prompt, and cancellation signal.
   * @returns Updated durable work item.
   */
  async append(caller: Agent, request: AppendCrewWorkRequest): Promise<CrewWorkItemSnapshot> {
    const { root, id } = this.lead(caller)
    if (this.managerIntegrations.has(root.id)) throw new CrewError('Manager verification is running', 'CREW_INVALID_TRANSITION')
    let current = this.requireWork(root, request.taskId, request.expectedRevision)
    const childId = current.developerSessionId
    if (childId === undefined) throw new CrewError('Crew work item has no developer to continue', 'CREW_UNAUTHORIZED_WORKER')
    if (current.stage !== 'running') {
      if (current.stage === 'integration_ready') {
        current = await this.updateWorkItem(root, {
          taskId: current.taskId, expectedRevision: current.revision,
          stage: 'paused', reason: 'Manager requested revisions from the existing developer.',
        })
      }
      const task = this.ctx.agentTeams.getTask(root, current.taskId)
      if (task.status === 'completed') {
        if (current.developerName === undefined) throw new CrewError('Developer name is missing', 'CREW_UNAUTHORIZED_WORKER')
        const reopened = await this.ctx.agentTeams.updateTask(root, { taskId: task.id, expectedRevision: task.revision, action: 'reopen' })
        await this.ctx.agentTeams.updateTask(root, {
          taskId: task.id, expectedRevision: reopened.revision, action: 'reassign', owner: current.developerName,
        })
      }
      if (current.stage === 'failed') {
        current = await this.updateWorkItem(root, {
          taskId: current.taskId,
          expectedRevision: current.revision,
          stage: 'queued',
          reason: 'Retry queued for the current developer.',
        })
      }
      if (current.stage !== 'queued' && current.stage !== 'revision_required' && current.stage !== 'paused') {
        throw new CrewError(`Crew work item cannot continue from "${current.stage}"`, 'CREW_INVALID_TRANSITION')
      }
      current = await this.updateWorkItem(root, {
        taskId: current.taskId,
        expectedRevision: current.revision,
        stage: 'running',
        reason: 'Developer continuation accepted.',
        attempt: current.attempt + 1,
      })
    }
    const content = crewText(request.message, 'append message', 16_384)
    const source: MessageSource = {
      kind: 'crew-worker',
      role: 'developer',
      teamId: id,
      taskId: current.taskId,
      workItemRevision: current.revision,
    }
    try {
      await steerHostSubagentPrompt(
        this.ctx.subagents,
        root,
        childId,
        [{ type: 'text', text: content }],
        source,
        this.operationSignal(request.signal),
      )
    } catch (error: unknown) {
      await this.pauseAfterDeliveryFailure(root, current, error)
      throw error
    }
    return current
  }

  /**
   * Interrupt and release the active worker, preserving its durable child descriptor.
   * @param caller - Exact live Team Lead managing the workflow.
   * @param request - Current revision and durable pause reason.
   * @returns Paused durable work item.
   */
  async stop(caller: Agent, request: StopCrewWorkRequest): Promise<CrewWorkItemSnapshot> {
    const { root } = this.lead(caller)
    const current = this.requireWork(root, request.taskId, request.expectedRevision)
    const workerId = current.stage === 'reviewing'
      ? current.reviewerSessionId
      : current.developerSessionId
    if (workerId === undefined) throw new CrewError('Crew work item has no active worker', 'CREW_UNAUTHORIZED_WORKER')
    if (!['queued', 'running', 'verifying', 'reviewing'].includes(current.stage)) {
      throw new CrewError(`Crew work item cannot stop from "${current.stage}"`, 'CREW_INVALID_TRANSITION')
    }
    this.intentionalStops.add(workerId)
    try {
      this.ctx.subagents.interrupt(workerId, { kind: 'ancestor', agent: root })
      await this.ctx.subagents.drainContinuableChildren(root, [workerId])
      const latest = this.requireWork(root, current.taskId, current.revision)
      const paused = await this.updateWorkItem(root, {
        taskId: latest.taskId,
        expectedRevision: latest.revision,
        stage: 'paused',
        reason: crewText(request.reason, 'stop reason', 2_000),
      })
      this.queueWorkNotification(root, paused)
      return paused
    } finally {
      this.intentionalStops.delete(workerId)
    }
  }

  /**
   * Replace a parked developer with a newly composed native child.
   * @param caller - Exact live Team Lead managing the workflow.
   * @param request - Current revision, replacement reason, and cancellation signal.
   * @returns Durable work item after replacement provisioning.
   */
  async reassign(caller: Agent, request: ReassignCrewWorkRequest): Promise<CrewWorkItemSnapshot> {
    const { root } = this.lead(caller)
    if (this.managerIntegrations.has(root.id)) throw new CrewError('Manager verification is running', 'CREW_INVALID_TRANSITION')
    const current = this.requireWork(root, request.taskId, request.expectedRevision)
    if (!['paused', 'failed', 'revision_required'].includes(current.stage)) {
      throw new CrewError(`Crew work item cannot be reassigned from "${current.stage}"`, 'CREW_INVALID_TRANSITION')
    }
    return await this.provisionDeveloper(root, current, request.signal, request.reason)
  }

  /**
   * Verify manager-reviewed files directly, or delegate independently reviewed modules.
   * @param caller - Exact live Team Lead managing the workflow.
   * @param request - Execution owner, review assessment, selected work, and combined commands.
   * @returns Terminal manager integration or running delegated integration.
   */
  async integrate(caller: Agent, request: IntegrateCrewRequest): Promise<CrewIntegrationSnapshot> {
    if (request.execution !== 'worker') return await this.integrateManager(caller, request)
    this.assertHostServices()
    const configuration = await this.ensureConfigured(caller)
    const { root, id } = this.lead(caller)
    if (this.managerIntegrations.has(root.id)) throw new CrewError('Manager verification is running', 'CREW_INVALID_TRANSITION')
    const state = this.journal.state(root)
    if (state.integrations.some(item => item.status === 'running')) {
      throw new CrewError('a Crew integration is already running', 'CREW_INVALID_TRANSITION')
    }
    const unsettled = state.workItems.find(item => !['integration_ready', 'accepted', 'failed', 'cancelled'].includes(item.stage))
    if (unsettled !== undefined) {
      throw new CrewError(`Crew work item "${unsettled.taskId}" is not quiescent`, 'CREW_INVALID_TRANSITION')
    }
    const selectedIds = request.taskIds === undefined
      ? state.workItems.filter(item => item.stage === 'integration_ready').map(item => item.taskId)
      : [...request.taskIds]
    if (selectedIds.length === 0 || new Set(selectedIds).size !== selectedIds.length) {
      throw new CrewError('Crew integration requires unique reviewed work items', 'CREW_INVALID_TRANSITION')
    }
    const selected = selectedIds.map((taskId) => {
      const workItem = this.requireWork(root, taskId)
      if (workItem.stage !== 'integration_ready'
        || workItem.latestVerificationId === undefined
        || workItem.latestReviewId === undefined) {
        throw new CrewError(`Crew work item "${taskId}" lacks current review evidence`, 'CREW_EVIDENCE_NOT_FOUND')
      }
      const verification = state.verifications.find(item => item.id === workItem.latestVerificationId)
      const review = state.reviews.find(item => item.id === workItem.latestReviewId)
      if (verification?.verdict !== 'passed' || review?.verdict !== 'passed'
        || review.verificationId !== verification.id
        || review.specRevision !== workItem.specRevision
        || verification.specRevision !== workItem.specRevision) {
        throw new CrewError(`Crew work item "${taskId}" evidence did not pass`, 'CREW_EVIDENCE_NOT_FOUND')
      }
      return { workItem, verification, review }
    })
    const allowedPrograms = new Set(configuration.allowedTestPrograms)
    const testCommands = request.testCommands.map(command => crewCommand(command, allowedPrograms))
    if (new Set(testCommands.map(command => command.id)).size !== testCommands.length) {
      throw new CrewError('Crew integration repeats a test command id', 'CREW_INVALID_COMMAND')
    }
    const inputCheckout = await this.host(configuration).inspectCheckout(configuration.repositoryRoot, this.operationSignal(request.signal))
    for (const { workItem, verification } of selected) {
      if (!sameWorkCheckout(verification.checkout, inputCheckout, workItem, verification.changedPaths)) {
        throw new CrewError(`Crew work item "${workItem.taskId}" changed after verification. Preserve the files; use manager integration with a current review summary and corrected verification commands, or continue the original developer. Do not delete work to restore an old checkout.`, 'CREW_STALE_REVISION')
      }
    }
    if (inputCheckout.stagedPaths.length > 0) {
      throw new CrewError('Crew integration requires an unstaged checkout', 'CREW_STALE_REVISION')
    }
    const integrationId = brandString<CrewIntegrationId>(randomUUID())
    const integratorSessionId = SessionId(randomUUID())
    const integration: CrewIntegrationSnapshot = {
      id: integrationId,
      revision: 1,
      status: 'running',
      integratorSessionId,
      inputCheckout,
      inputs: selected.map(({ workItem, verification, review }) => ({
        taskId: workItem.taskId,
        workItemRevision: workItem.revision,
        verificationId: verification.id,
        reviewId: review.id,
      })),
      testCommands,
      commands: [],
      issues: [],
      summary: 'Integration worker provisioned with project read and write access.',
    }
    await this.journal.transact(root.id, async () => {
      const currentState = this.journal.state(root)
      if (currentState.integrations.some(item => item.status === 'running')) {
        throw new CrewError('a Crew integration is already running', 'CREW_INVALID_TRANSITION')
      }
      if (currentState.workItems.some(item => !['integration_ready', 'accepted', 'failed', 'cancelled'].includes(item.stage))) {
        throw new CrewError('Crew work changed while preparing integration', 'CREW_STALE_REVISION')
      }
      for (const { workItem } of selected) this.requireWork(root, workItem.taskId, workItem.revision)
      await this.journal.appendAndFlush(root, 'crew/integration', { version: 1, teamId: id, integration })
    })
    const name = workerName('integrator', 'reviewed-set', 1, integratorSessionId)
    try {
      await this.ctx.agentTeams.spawnTeammate(root, {
        childId: integratorSessionId,
        name,
        description: `Integrator for ${selected.length} reviewed work items`,
        prompt: [{ type: 'text', text: integratorPrompt(integration, selected.map(item => item.workItem)) }],
        promptSource: {
          kind: 'crew-worker',
          role: 'integrator',
          teamId: id,
          integrationId,
          integrationRevision: integration.revision,
        },
        context: 'fresh',
        provider: configuration.nativeProvider,
        agentOptions: this.workerOptions('integrator', configuration),
        persona: configuration.roles.integrator.persona,
        toolFilter: configuration.roles.integrator.toolFilter,
        maxDepth: configuration.roles.integrator.maxDepth,
        signal: this.operationSignal(request.signal),
      })
    } catch (error: unknown) {
      await this.publishIntegrationTerminal(root, integration, {
        ...integration,
        revision: 2,
        status: 'failed',
        summary: `Integrator provisioning failed: ${errorMessage(error)}`,
        stopReason: 'error',
      })
      throw error
    }
    const terminal = this.terminalEnds.get(integratorSessionId)
    if (terminal !== undefined) this.scheduleTerminal(root, terminal)
    return structuredClone(integration)
  }

  /** Verify a manager-reviewed checkout without delegating another model turn. */
  private async integrateManager(caller: Agent, request: IntegrateCrewRequest): Promise<CrewIntegrationSnapshot> {
    this.assertHostServices()
    const configuration = await this.ensureConfigured(caller)
    const { root, id } = this.lead(caller)
    if (this.managerIntegrations.has(root.id)) throw new CrewError('Manager verification is running', 'CREW_INVALID_TRANSITION')
    const summary = crewText(request.reviewSummary ?? '', 'manager review summary', 16_384)
    const state = this.journal.state(root)
    const eligible = ['integration_ready', 'paused', 'failed', 'revision_required']
    if (state.integrations.some(item => item.status === 'running')
      || state.workItems.some(item => workItemActive(item.stage))) {
      throw new CrewError('Stop active workers before manager repair and integration', 'CREW_INVALID_TRANSITION')
    }
    const selectedIds = request.taskIds ?? state.workItems.filter(item => eligible.includes(item.stage)).map(item => item.taskId)
    if (selectedIds.length === 0 || new Set(selectedIds).size !== selectedIds.length) {
      throw new CrewError('Manager integration requires unique completed or paused work items', 'CREW_INVALID_TRANSITION')
    }
    const selected = selectedIds.map((taskId) => {
      const item = this.requireWork(root, taskId)
      if (!eligible.includes(item.stage)) throw new CrewError(`Cannot integrate work in ${item.stage}`, 'CREW_INVALID_TRANSITION')
      return item
    })
    const allowedPrograms = new Set(configuration.allowedTestPrograms)
    const testCommands = request.testCommands.map(command => crewCommand(command, allowedPrograms))
    if (new Set(testCommands.map(command => command.id)).size !== testCommands.length) {
      throw new CrewError('Crew integration repeats a test command id', 'CREW_INVALID_COMMAND')
    }
    const managerPaths = (request.changedPaths ?? []).map(path => repositoryPath(path, 'manager changed path'))
    const signal = this.operationSignal(request.signal)
    this.managerIntegrations.add(root.id)
    const verifying: CrewWorkItemSnapshot[] = []
    try {
      const host = this.host(configuration)
      const before = await host.inspectCheckout(configuration.repositoryRoot, signal)
      if (before.stagedPaths.length > 0) throw new CrewError('Manager integration requires an unstaged checkout', 'CREW_STALE_REVISION')
      const observedChanges = new Set(selected.flatMap(item => changedSince(item.baseline, before)))
      const unobserved = managerPaths.filter(path => !observedChanges.has(path))
      if (unobserved.length > 0) throw new CrewError(`Manager paths have no observed change: ${unobserved.join(', ')}`, 'CREW_CHECKOUT_DRIFT')
      for (const item of selected) {
        const report: CrewReportSnapshot = {
          id: brandString<CrewReportId>(randomUUID()), taskId: item.taskId, workItemRevision: item.revision,
          role: 'developer', workerSessionId: root.id, specRevision: item.specRevision,
          verdict: 'ready', summary: `Manager handoff: ${summary}`,
          changedPaths: changedSince(item.baseline, before).filter(path =>
            [...item.writeScopes, ...configuration.sharedDirectories].some(scope => pathInCrewScope(path, scope))),
          issues: [],
        }
        await this.journal.transact(root.id, async () => {
          this.requireWork(root, item.taskId, item.revision)
          await this.journal.appendAndFlush(root, 'crew/report', { version: 1, teamId: id, report })
        })
        verifying.push(await this.updateWorkItem(root, {
          taskId: item.taskId, expectedRevision: item.revision, stage: 'verifying',
          latestReportId: report.id, reason: 'Manager is verifying the current files; existing artifacts are retained.',
        }))
      }
      const startedAt = Date.now()
      const commands: CrewCommandResult[] = []
      for (const command of testCommands) commands.push(await host.runCommand(configuration.repositoryRoot, command, signal))
      const checkout = await host.inspectCheckout(configuration.repositoryRoot, signal)
      const commonFailures = [
        ...(sameCheckoutWorld(before, checkout) ? [] : ['project inputs changed during manager verification']),
        ...(checkout.stagedPaths.length === 0 ? [] : ['checkout contains staged paths']),
        ...commands.filter(command => command.timedOut || command.exitCode !== 0).map(command => `test ${command.commandId} failed`),
      ]
      const inputs: CrewIntegrationSnapshot['inputs'] = []
      const failures: string[] = []
      const approvedPaths = new Set(managerPaths)
      for (const item of verifying) {
        const report = this.journal.state(root).reports.find(value => value.id === item.latestReportId)
        if (report === undefined) throw new CrewError('Manager handoff report is missing', 'CREW_EVIDENCE_NOT_FOUND')
        const missingArtifacts = await host.missingArtifacts(configuration.repositoryRoot, item.requiredArtifacts, signal)
        const issues = [...commonFailures,
          ...(item.baseline.head === checkout.head ? [] : ['repository HEAD changed']),
          ...missingArtifacts.map(path => `required artifact is missing: ${path}`),
        ]
        const verification: CrewVerificationSnapshot = {
          id: brandString<CrewVerificationId>(randomUUID()), taskId: item.taskId, reportId: report.id,
          workerSessionId: root.id, specRevision: item.specRevision, startedAt, finishedAt: Date.now(),
          workerStopReason: 'completed', checkout, changedPaths: report.changedPaths,
          outOfScopePaths: [], missingArtifacts, commands, verdict: issues.length === 0 ? 'passed' : 'failed',
          summary: issues.length === 0 ? 'Host verified the manager-reviewed files.' : issues.join('; '),
        }
        await this.publishVerification(root, item, verification)
        if (issues.length > 0) {
          failures.push(`${item.moduleKey}: ${verification.summary}`)
          await this.updateWorkItem(root, {
            taskId: item.taskId, expectedRevision: item.revision, stage: 'paused',
            latestVerificationId: verification.id, reason: verification.summary,
          })
          continue
        }
        const reviewReport: CrewReportSnapshot = {
          id: brandString<CrewReportId>(randomUUID()), taskId: item.taskId, workItemRevision: item.revision,
          role: 'reviewer', workerSessionId: root.id, specRevision: item.specRevision,
          verificationId: verification.id, verdict: 'passed', summary: `Manager review: ${summary}`, changedPaths: [], issues: [],
        }
        await this.journal.transact(root.id, async () => {
          this.requireWork(root, item.taskId, item.revision)
          await this.journal.appendAndFlush(root, 'crew/report', { version: 1, teamId: id, report: reviewReport })
        })
        const review: CrewReviewSnapshot = {
          id: brandString<CrewReviewId>(randomUUID()), taskId: item.taskId, reportId: reviewReport.id,
          reviewerSessionId: root.id, specRevision: item.specRevision, verificationId: verification.id,
          round: item.reviewRound + 1, verdict: 'passed', issues: [], summary: reviewReport.summary, stopReason: 'completed',
        }
        await this.publishReview(root, item, review)
        let teamTask = this.ctx.agentTeams.getTask(root, item.taskId)
        if (teamTask.status === 'pending') teamTask = await this.ctx.agentTeams.updateTask(root, {
          taskId: teamTask.id, expectedRevision: teamTask.revision, action: 'claim',
        })
        if (teamTask.status !== 'completed') await this.ctx.agentTeams.updateTask(root, {
          taskId: teamTask.id, expectedRevision: teamTask.revision, action: 'complete',
        })
        const ready = await this.updateWorkItem(root, {
          taskId: item.taskId, expectedRevision: item.revision, stage: 'integration_ready',
          latestVerificationId: verification.id, latestReviewId: review.id, reason: review.summary,
        })
        inputs.push({ taskId: item.taskId, workItemRevision: ready.revision, verificationId: verification.id, reviewId: review.id })
        for (const path of verification.changedPaths) approvedPaths.add(path)
      }
      if (failures.length > 0) throw new CrewError(`Manager verification failed; files were retained. ${failures.join('; ')}`, 'CREW_EVIDENCE_NOT_FOUND')
      const integration: CrewIntegrationSnapshot = {
        id: brandString<CrewIntegrationId>(randomUUID()), revision: 1, status: 'running',
        integratorSessionId: root.id, execution: 'manager', inputCheckout: checkout,
        inputs, testCommands, commands: [], issues: [], summary: `Manager integration: ${summary}`,
      }
      await this.journal.transact(root.id, async () => {
        for (const input of inputs) this.requireWork(root, input.taskId, input.workItemRevision)
        await this.journal.appendAndFlush(root, 'crew/integration', { version: 1, teamId: id, integration })
      })
      const passed: CrewIntegrationSnapshot = {
        ...integration, revision: 2, status: 'passed', commands, checkout,
        approvedPaths: [...approvedPaths].sort(), stopReason: 'completed',
      }
      await this.publishIntegrationTerminal(root, integration, passed)
      for (const input of inputs) {
        const task = this.ctx.agentTeams.getTask(root, input.taskId)
        if (task.status !== 'completed') await this.ctx.agentTeams.updateTask(root, { taskId: task.id, expectedRevision: task.revision, action: 'complete' })
        await this.updateWorkItem(root, {
          taskId: input.taskId, expectedRevision: input.workItemRevision, stage: 'accepted',
          reason: 'Accepted by manager review and current host verification.', acceptedIntegrationId: passed.id,
        })
      }
      return structuredClone(passed)
    } finally {
      try {
        for (const item of verifying) {
          const current = this.requireWork(root, item.taskId)
          if (current.stage === 'verifying') await this.updateWorkItem(root, {
            taskId: current.taskId, expectedRevision: current.revision, stage: 'paused',
            reason: 'Manager verification did not finish. Preserve files and retry with corrected commands.',
          })
        }
      } finally { this.managerIntegrations.delete(root.id) }
    }
  }

  /** Execute one local commit after the Consumer's generic approval has completed. */
  async [approvedCrewCommit](caller: Agent, request: CommitCrewRequest): Promise<CrewCommitSnapshot> {
    this.assertHostServices()
    const configuration = await this.ensureConfigured(caller)
    const { root, id } = this.lead(caller)
    const state = this.journal.state(root)
    const integration = state.integrations.find(item => item.id === request.integrationId)
    if (integration?.status !== 'passed' || integration.checkout === undefined || integration.approvedPaths === undefined) {
      throw new CrewError('Crew commit requires a current passing integration', 'CREW_COMMIT_REJECTED')
    }
    const passingCheckout = structuredClone(integration.checkout)
    const approvedPaths = structuredClone(integration.approvedPaths)
    if (state.workItems.some(item => !['accepted', 'failed', 'cancelled'].includes(item.stage))
      || state.integrations.some(item => item.status === 'running')) {
      throw new CrewError('Crew commit requires a quiescent workflow', 'CREW_COMMIT_REJECTED')
    }
    const message = crewText(request.message, 'commit message', configuration.commitPolicy.maxMessageLength)
    const approvalCallId = crewText(request.approvalCallId, 'approval call id', 512)
    const commitId = brandString<CrewCommitId>(randomUUID())
    const reject = async (reason: string): Promise<never> => {
      const commit: CrewCommitSnapshot = {
        id: commitId,
        integrationId: integration.id,
        approvalCallId,
        stagedPaths: structuredClone(approvedPaths),
        message,
        status: 'rejected',
        reason,
      }
      await this.journal.appendAndFlush(root, 'crew/commit', { version: 1, teamId: id, commit })
      throw new CrewError(reason, 'CREW_COMMIT_REJECTED')
    }
    return await this.journal.transact(root.id, async () => {
      const currentState = this.journal.state(root)
      const currentIntegration = currentState.integrations.find(item => item.id === integration.id)
      if (currentIntegration?.revision !== integration.revision || currentIntegration.status !== 'passed') {
        return await reject('Crew integration changed before commit.')
      }
      const checkout = await this.host(configuration).inspectCheckout(configuration.repositoryRoot, this.operationSignal(request.signal))
      if (checkout.head === null) {
        return await reject('Local development is complete without a commit. crew_commit requires an existing Git repository with a committed HEAD.')
      }
      if (configuration.commitPolicy.requireNamedBranch && checkout.branch === undefined) {
        return await reject('Crew commit requires a named branch.')
      }
      if (!sameCheckoutWorld(checkout, passingCheckout) || checkout.stagedPaths.length > 0) {
        return await reject('Checkout changed after the passing integration.')
      }
      if (approvedPaths.length === 0) return await reject('Passing integration contains no changed paths to commit.')
      const staged = await this.host(configuration).runGit(
        configuration.repositoryRoot,
        ['add', '--', ...approvedPaths],
        this.operationSignal(request.signal),
      )
      if (staged.timedOut || staged.exitCode !== 0) return await reject('Git could not stage the approved Crew paths.')
      const stagedCheckout = await this.host(configuration).inspectCheckout(
        configuration.repositoryRoot, this.operationSignal(request.signal),
      )
      if (stagedCheckout.head !== checkout.head
        || !sameStringSet(stagedCheckout.changedPaths, checkout.changedPaths)
        || !samePathDigests(stagedCheckout.pathDigests, checkout.pathDigests)
        || !sameStringSet(stagedCheckout.stagedPaths, approvedPaths)) {
        return await reject('Git staging did not produce the exact approved path set.')
      }
      const committed = await this.host(configuration).runGit(
        configuration.repositoryRoot,
        ['commit', '--only', '-m', message, '--', ...approvedPaths],
        this.operationSignal(request.signal),
      )
      if (committed.timedOut || committed.exitCode !== 0) return await reject('Git could not commit the approved Crew paths.')
      const committedCheckout = await this.host(configuration).inspectCheckout(
        configuration.repositoryRoot, this.operationSignal(request.signal),
      )
      if (committedCheckout.head === null || committedCheckout.head === checkout.head) return await reject('Git commit did not advance HEAD.')
      const result: CrewCommitSnapshot = {
        id: commitId,
        integrationId: integration.id,
        approvalCallId,
        stagedPaths: structuredClone(approvedPaths),
        message,
        status: 'committed',
        commitHash: committedCheckout.head,
      }
      await this.journal.appendAndFlush(root, 'crew/commit', { version: 1, teamId: id, commit: result })
      return structuredClone(result)
    })
  }

  /**
   * Resolve the exact durable Crew role currently owned by one worker Agent.
   * @param caller - Exact live Team teammate requesting a worker operation.
   * @returns Current work-item or integration binding.
   */
  workerBinding(caller: Agent): CrewWorkerBinding {
    const membership = this.ctx.agentTeams.tryMembership(caller)
    if (membership === undefined || membership.role !== 'teammate') {
      throw new CrewError('Crew worker operation requires an active Team teammate', 'CREW_UNAUTHORIZED_WORKER')
    }
    const state = this.journal.state(membership.root)
    for (const workItem of state.workItems) {
      // The in-process continuation can publish its Agent immediately after
      // accepting the first prompt, before spawnTeammate() returns and the Lead
      // advances the reserved item to running. The durable child id and Team
      // provisioning membership already identify the only authorized caller.
      if (workItem.developerSessionId === caller.id
        && (workItem.stage === 'queued' || workItem.stage === 'running')) {
        return {
          role: 'developer',
          rootSessionId: membership.root.id,
          taskId: workItem.taskId,
          workItemRevision: workItem.revision,
        }
      }
      if (workItem.reviewerSessionId === caller.id && workItem.stage === 'reviewing') {
        return {
          role: 'reviewer',
          rootSessionId: membership.root.id,
          taskId: workItem.taskId,
          workItemRevision: workItem.revision,
        }
      }
    }
    const integration = state.integrations.find(item => item.integratorSessionId === caller.id && item.status === 'running')
    if (integration !== undefined) {
      return {
        role: 'integrator',
        rootSessionId: membership.root.id,
        integrationId: integration.id,
        integrationRevision: integration.revision,
      }
    }
    throw new CrewError('worker is not bound to current Crew work', 'CREW_UNAUTHORIZED_WORKER')
  }

  /**
   * Read one file through the caller's durable Crew scope.
   * @param caller - Exact live Crew worker Agent.
   * @param path - Candidate repository-relative file path.
   * @param signal - Caller cancellation signal.
   * @returns Normalized path and bounded UTF-8 content.
   */
  async readWorkerFile(caller: Agent, path: string, signal: AbortSignal): Promise<CrewFileRead> {
    const access = this.workerAccess(caller)
    return await this.workspace.read(access.configuration.repositoryRoot, path, access.readScopes, this.operationSignal(signal))
  }

  /**
   * Read one repository file as the Team Lead without exposing Git metadata or credentials.
   * @param caller - Exact live Team Lead.
   * @param path - Candidate repository-relative file path.
   * @param signal - Caller cancellation signal.
   * @returns Normalized path and bounded UTF-8 content.
   */
  async readManagerFile(caller: Agent, path: string, signal: AbortSignal): Promise<CrewFileRead> {
    const configuration = await this.ensureConfigured(caller)
    return await this.workspace.read(configuration.repositoryRoot, path, undefined, this.operationSignal(signal))
  }

  /**
   * List one repository directory as the Team Lead.
   * @param caller - Exact live Team Lead.
   * @param path - Candidate repository-relative directory path.
   * @param signal - Caller cancellation signal.
   * @returns Bounded direct directory entries.
   */
  async listManagerFiles(caller: Agent, path: string, signal: AbortSignal): Promise<CrewFileEntry[]> {
    const configuration = await this.ensureConfigured(caller)
    return await this.workspace.list(configuration.repositoryRoot, path, undefined, this.operationSignal(signal))
  }

  /**
   * Create or replace one repository file as the Team Lead through Crew path policy.
   * @param caller - Exact live Team Lead.
   * @param path - Candidate repository-relative file path.
   * @param content - Complete replacement UTF-8 content.
   * @param signal - Caller cancellation signal.
   * @returns Normalized path and whether the file was created or updated.
   */
  async writeManagerFile(caller: Agent, path: string, content: string, signal: AbortSignal): Promise<{ path: string; operation: 'create' | 'update' }> {
    const configuration = await this.ensureConfigured(caller)
    return await this.workspace.write(configuration.repositoryRoot, path, content, undefined, this.operationSignal(signal))
  }

  /**
   * Apply one literal repository edit as the Team Lead through Crew path policy.
   * @param caller - Exact live Team Lead.
   * @param path - Candidate repository-relative file path.
   * @param oldString - Literal text that must exist.
   * @param newString - Literal replacement text.
   * @param replaceAll - Whether every occurrence may be replaced.
   * @param signal - Caller cancellation signal.
   * @returns Normalized path and confirmed replacement status.
   */
  async editManagerFile(
    caller: Agent,
    path: string,
    oldString: string,
    newString: string,
    replaceAll: boolean,
    signal: AbortSignal,
  ): Promise<{ path: string; replaced: true }> {
    const configuration = await this.ensureConfigured(caller)
    return await this.workspace.edit(
      configuration.repositoryRoot,
      path,
      oldString,
      newString,
      replaceAll,
      undefined,
      this.operationSignal(signal),
    )
  }

  /**
   * List one directory through the caller's durable Crew scope.
   * @param caller - Exact live Crew worker Agent.
   * @param path - Candidate repository-relative directory path.
   * @param signal - Caller cancellation signal.
   * @returns Bounded direct directory entries.
   */
  async listWorkerFiles(caller: Agent, path: string, signal: AbortSignal): Promise<CrewFileEntry[]> {
    const access = this.workerAccess(caller)
    return await this.workspace.list(access.configuration.repositoryRoot, path, access.readScopes, this.operationSignal(signal))
  }

  /**
   * Write a developer-scoped file or an integrator's project file; reviewers cannot write.
   * @param caller - Exact live Crew worker Agent.
   * @param path - Candidate repository-relative file path.
   * @param content - Complete replacement UTF-8 content.
   * @param signal - Caller cancellation signal.
   * @returns Normalized path and whether the file was created or updated.
   */
  async writeWorkerFile(caller: Agent, path: string, content: string, signal: AbortSignal): Promise<{ path: string; operation: 'create' | 'update' }> {
    const access = this.workerAccess(caller)
    if (access.binding.role === 'reviewer') throw new CrewError('Crew role is read-only', 'CREW_UNAUTHORIZED_WORKER')
    return await this.workspace.write(access.configuration.repositoryRoot, path, content, access.writeScopes, this.operationSignal(signal))
  }

  /**
   * Apply one literal edit within the developer's assignment or the integrator's project.
   * @param caller - Exact live Crew worker Agent.
   * @param path - Candidate repository-relative file path.
   * @param oldString - Literal text that must exist.
   * @param newString - Literal replacement text.
   * @param replaceAll - Whether every occurrence may be replaced.
   * @param signal - Caller cancellation signal.
   * @returns Normalized path and confirmed replacement status.
   */
  async editWorkerFile(
    caller: Agent,
    path: string,
    oldString: string,
    newString: string,
    replaceAll: boolean,
    signal: AbortSignal,
  ): Promise<{ path: string; replaced: true }> {
    const access = this.workerAccess(caller)
    if (access.binding.role === 'reviewer') throw new CrewError('Crew role is read-only', 'CREW_UNAUTHORIZED_WORKER')
    return await this.workspace.edit(
      access.configuration.repositoryRoot,
      path,
      oldString,
      newString,
      replaceAll,
      access.writeScopes,
      this.operationSignal(signal),
    )
  }

  /**
   * Run a declared module or integration test for the exact current worker.
   * @param caller - Exact live worker Agent.
   * @param commandId - Predeclared command identity from the work item or integration.
   * @param signal - Caller cancellation signal.
   * @returns Host-authoritative bounded command result.
   */
  async runWorkerTest(caller: Agent, commandId: string, signal: AbortSignal): Promise<CrewTestRun> {
    const access = this.workerAccess(caller)
    const binding = access.binding
    const integration = binding.role === 'integrator'
      ? this.journal.state(access.root).integrations.find(item => item.id === binding.integrationId)
      : undefined
    const commands = integration?.testCommands ?? access.workItem?.testCommands
    if (commands === undefined) throw new CrewError('Crew worker test assignment is absent', 'CREW_WORK_ITEM_NOT_FOUND')
    const id = crewKey(commandId, 'commandId')
    const command = commands.find(item => item.id === id)
    if (command === undefined) throw new CrewError(`Crew test command "${id}" is not declared`, 'CREW_INVALID_COMMAND')
    return {
      ...(binding.role === 'integrator' ? { integrationId: binding.integrationId } : { taskId: binding.taskId }),
      result: await this.host(access.configuration).runCommand(
        access.configuration.repositoryRoot, command, this.operationSignal(signal),
      ),
    }
  }

  /**
   * Persist one structured report attributed to the exact current worker binding.
   * @param caller - Exact live Crew worker Agent.
   * @param request - Structured verdict, evidence summary, paths, and issues.
   * @returns Immutable durable worker report.
   */
  async recordReport(caller: Agent, request: RecordCrewReportRequest): Promise<CrewReportSnapshot> {
    const access = this.workerAccess(caller)
    const summary = crewText(request.summary, 'report summary', 16_384)
    const changedPaths = [...new Set(request.changedPaths.map((path, index) => repositoryPath(path, `changedPaths[${index}]`)))]
    const issues = request.issues.map((issue, index) => ({
      path: repositoryPath(issue.path, `issues[${index}].path`),
      ...(issue.line === undefined ? {} : { line: positiveSafeInteger(issue.line, `issues[${index}].line`) }),
      message: crewText(issue.message, `issues[${index}].message`, 4_000),
      expected: crewText(issue.expected, `issues[${index}].expected`, 4_000),
    }))
    this.assertReportVerdict(access.binding.role, request.verdict)
    if (access.binding.role === 'reviewer') {
      if (access.workItem?.latestVerificationId === undefined
        || request.verificationId !== access.workItem.latestVerificationId) {
        throw new CrewError('reviewer report must name the current verification', 'CREW_EVIDENCE_NOT_FOUND')
      }
    } else if (request.verificationId !== undefined) {
      throw new CrewError('only a reviewer report can name a verification', 'CREW_EVIDENCE_NOT_FOUND')
    }
    let report: CrewReportSnapshot
    if (access.binding.role === 'integrator') {
      report = {
        id: brandString<CrewReportId>(randomUUID()),
        integrationId: access.binding.integrationId,
        integrationRevision: access.binding.integrationRevision,
        role: 'integrator',
        workerSessionId: caller.id,
        verdict: request.verdict,
        summary,
        changedPaths,
        issues,
      }
    } else {
      const workItem = access.workItem
      if (workItem === undefined) throw new CrewError('Crew worker work item is absent', 'CREW_WORK_ITEM_NOT_FOUND')
      report = {
        id: brandString<CrewReportId>(randomUUID()),
        taskId: access.binding.taskId,
        workItemRevision: access.binding.workItemRevision,
        role: access.binding.role,
        workerSessionId: caller.id,
        specRevision: workItem.specRevision,
        ...(access.binding.role === 'reviewer'
          ? { verificationId: workItem.latestVerificationId }
          : {}),
        verdict: request.verdict,
        summary,
        changedPaths,
        issues,
      }
    }
    const root = access.root
    const teamId = this.journal.state(root).id
    return await this.journal.transact(root.id, async () => {
      this.assertBindingCurrent(root, caller, access.binding)
      const state = this.journal.state(root)
      const duplicate = state.reports.some(item => item.workerSessionId === caller.id
        && item.role === report.role
        && item.workItemRevision === report.workItemRevision
        && item.integrationRevision === report.integrationRevision)
      if (duplicate) throw new CrewError('Crew worker already reported for this binding revision', 'CREW_EVIDENCE_EXISTS')
      await this.journal.appendAndFlush(root, 'crew/report', { version: 1, teamId, report })
      return structuredClone(report)
    })
  }

  /**
   * Bind one existing Team task to an immutable Crew module specification.
   * @param caller - Exact live Team Lead.
   * @param request - Existing task identity, module scope, evidence, and checkout baseline.
   * @returns Newly persisted planned work item.
   */
  async createWorkItem(caller: Agent, request: CreateCrewWorkItemRequest): Promise<CrewWorkItemSnapshot> {
    await this.ensureConfigured(caller)
    const { root, id } = this.lead(caller)
    return await this.journal.transact(root.id, async () => {
      const state = this.journal.state(root)
      const configuration = state.configuration
      if (configuration === undefined) throw new CrewError('Crew is not configured', 'CREW_NOT_CONFIGURED')
      if (state.workItems.some(item => item.taskId === request.taskId)) {
        throw new CrewError(`Crew work item "${request.taskId}" already exists`, 'CREW_WORK_ITEM_EXISTS')
      }
      const task = this.ctx.agentTeams.getTask(root, request.taskId)
      if (task.status === 'completed' || task.status === 'deleted') {
        throw new CrewError(`Team task "${request.taskId}" is not available for Crew work`, 'CREW_TEAM_TASK_MISMATCH')
      }
      const moduleKey = crewKey(request.moduleKey, 'moduleKey')
      const specPath = repositoryPath(request.specPath, 'specPath')
      const specRevision = positiveSafeInteger(request.specRevision, 'specRevision')
      const readScopes = [...new Set(request.readScopes.map((value, index) => repositoryPath(value, `readScopes[${index}]`)))]
      const writeScopes = [...new Set(request.writeScopes.map((value, index) => repositoryPath(value, `writeScopes[${index}]`)))]
      if (writeScopes.length === 0) throw new CrewError('Crew work item requires at least one write scope', 'CREW_INVALID_PATH')
      const requiredArtifacts = [...new Set(request.requiredArtifacts.map((value, index) => repositoryPath(value, `requiredArtifacts[${index}]`)))]
      const allowedPrograms = new Set(configuration.allowedTestPrograms)
      const testCommands = request.testCommands.map(command => crewCommand(command, allowedPrograms))
      if (new Set(testCommands.map(command => command.id)).size !== testCommands.length) {
        throw new CrewError('Crew work item repeats a test command id', 'CREW_INVALID_COMMAND')
      }
      if (!sameScopes(task.writeScopes, writeScopes)) {
        throw new CrewError(`Team task "${request.taskId}" write scopes do not match Crew scopes`, 'CREW_TEAM_TASK_MISMATCH')
      }
      for (const other of state.workItems.filter(item => workItemActive(item.stage))) {
        if (writeScopes.some(left => other.writeScopes.some(right => crewScopesOverlap(left, right)))) {
          throw new CrewError(`Crew write scopes overlap active work item "${other.taskId}"`, 'CREW_SCOPE_OVERLAP')
        }
      }
      if (state.workItems.filter(item => workItemActive(item.stage)).length >= configuration.maxConcurrentWorkers) {
        throw new CrewError(`Crew worker limit ${configuration.maxConcurrentWorkers} reached`, 'CREW_INVALID_TRANSITION')
      }
      const workItem: CrewWorkItemSnapshot = {
        taskId: request.taskId,
        revision: 1,
        moduleKey,
        reviewMode: request.reviewMode ?? 'manager',
        specPath,
        specRevision,
        readScopes,
        writeScopes,
        requiredArtifacts,
        testCommands,
        baseline: crewCheckout(request.baseline),
        stage: 'planned',
        workerSessionIds: [],
        attempt: 1,
        automaticRepairCount: 0,
        reviewRound: 0,
      }
      await this.journal.appendAndFlush(root, 'crew/work-item', { version: 1, teamId: id, workItem })
      return structuredClone(workItem)
    })
  }

  /**
   * Apply one authorized compare-and-set workflow transition.
   * @param caller - Exact live Team Lead.
   * @param request - Expected revision and complete transition updates.
   * @returns Updated durable work item.
   */
  async updateWorkItem(caller: Agent, request: UpdateCrewWorkItemRequest): Promise<CrewWorkItemSnapshot> {
    const { root, id } = this.lead(caller)
    return await this.journal.transact(root.id, async () => {
      const state = this.journal.state(root)
      const current = state.workItems.find(item => item.taskId === request.taskId)
      if (current === undefined) throw new CrewError(`Crew work item "${request.taskId}" not found`, 'CREW_WORK_ITEM_NOT_FOUND')
      if (current.revision !== request.expectedRevision) {
        throw new CrewError(
          `stale Crew work item "${request.taskId}" revision ${request.expectedRevision}; current revision is ${current.revision}`,
          'CREW_STALE_REVISION',
        )
      }
      if ((request.stage === 'running' || request.stage === 'queued') && !workItemActive(current.stage)
        && state.workItems.filter(item => item.taskId !== current.taskId && workItemActive(item.stage)).length
          >= (state.configuration?.maxConcurrentWorkers ?? DEFAULT_MAX_CONCURRENT_WORKERS)) {
        throw new CrewError('Crew worker limit reached; continue this task after another worker finishes', 'CREW_INVALID_TRANSITION')
      }
      if (!canTransitionCrewStage(current.stage, request.stage)) {
        throw new CrewError(
          `invalid Crew work-item transition ${current.stage} -> ${request.stage}`,
          'CREW_INVALID_TRANSITION',
        )
      }
      this.assertTeamTaskStage(this.ctx.agentTeams.getTask(root, request.taskId), request.stage)
      const reason = request.reason === undefined
        ? current.reason
        : crewText(request.reason, 'reason', 2_000)
      const developerName = request.developerName === undefined
        ? current.developerName
        : crewKey(request.developerName, 'developerName')
      const reviewerName = request.reviewerName === undefined
        ? current.reviewerName
        : crewKey(request.reviewerName, 'reviewerName')
      const attempt = request.attempt === undefined
        ? current.attempt
        : positiveSafeInteger(request.attempt, 'attempt')
      const automaticRepairCount = request.automaticRepairCount === undefined
        ? current.automaticRepairCount
        : nonNegativeSafeInteger(request.automaticRepairCount, 'automaticRepairCount')
      const reviewRound = request.reviewRound === undefined
        ? current.reviewRound
        : nonNegativeSafeInteger(request.reviewRound, 'reviewRound')
      this.assertEvidenceLinks(state, current, request)
      const workerSessionIds = request.appendWorkerSessionId === undefined
        ? structuredClone(current.workerSessionIds)
        : [...current.workerSessionIds, request.appendWorkerSessionId]
      if (new Set(workerSessionIds).size !== workerSessionIds.length) {
        throw new CrewError('Crew work item repeats a worker Session id', 'CREW_EVIDENCE_EXISTS')
      }
      const next: CrewWorkItemSnapshot = {
        ...current,
        revision: current.revision + 1,
        stage: request.stage,
        ...reason === undefined ? {} : { reason },
        ...developerName === undefined ? {} : { developerName },
        ...request.developerSessionId !== undefined
          ? { developerSessionId: request.developerSessionId }
          : current.developerSessionId === undefined ? {} : { developerSessionId: current.developerSessionId },
        ...reviewerName === undefined ? {} : { reviewerName },
        ...request.reviewerSessionId !== undefined
          ? { reviewerSessionId: request.reviewerSessionId }
          : current.reviewerSessionId === undefined ? {} : { reviewerSessionId: current.reviewerSessionId },
        workerSessionIds,
        attempt,
        automaticRepairCount,
        reviewRound,
        ...request.latestReportId !== undefined
          ? { latestReportId: request.latestReportId }
          : current.latestReportId === undefined ? {} : { latestReportId: current.latestReportId },
        ...request.latestVerificationId !== undefined
          ? { latestVerificationId: request.latestVerificationId }
          : current.latestVerificationId === undefined ? {} : { latestVerificationId: current.latestVerificationId },
        ...request.latestReviewId !== undefined
          ? { latestReviewId: request.latestReviewId }
          : current.latestReviewId === undefined ? {} : { latestReviewId: current.latestReviewId },
        ...request.acceptedIntegrationId !== undefined
          ? { acceptedIntegrationId: request.acceptedIntegrationId }
          : current.acceptedIntegrationId === undefined ? {} : { acceptedIntegrationId: current.acceptedIntegrationId },
      }
      await this.journal.appendAndFlush(root, 'crew/work-item', { version: 1, teamId: id, workItem: next })
      return structuredClone(next)
    })
  }

  /**
   * Return a detached browser-safe projection for the manager Session.
   * @param caller - Exact live Team Lead.
   * @returns Detached current Crew view.
   */
  view(caller: Agent): CrewView {
    const { root } = this.lead(caller)
    const state = this.journal.state(root)
    return {
      configured: state.configuration !== undefined,
      ...state.configuration === undefined ? {} : { repositoryRoot: state.configuration.repositoryRoot },
      workItems: structuredClone(state.workItems),
      reports: structuredClone(state.reports),
      verifications: structuredClone(state.verifications),
      reviews: structuredClone(state.reviews),
      integrations: structuredClone(state.integrations),
      notifications: structuredClone(state.notifications),
      commits: structuredClone(state.commits),
    }
  }

  /**
   * Generated Remote read for the manager-only Crew panel.
   * @param agent - Authenticated Agent supplied by the Remote gateway.
   * @returns Detached current Crew view.
   */
  @Remote('view')
  remoteView(agent: Agent): CrewView {
    return this.view(agent)
  }

  /**
   * Preserve expected Crew rejections as Remote business results.
   * @param operation - In-flight Crew mutation.
   * @returns Success value or stable conflict/rejection result.
   */
  async mutationResult<T>(operation: Promise<T>): Promise<CrewMutationResult<T>> {
    try {
      return { ok: true, value: await operation }
    } catch (error: unknown) {
      if (!(error instanceof CrewError)) throw error
      return {
        ok: false,
        error: {
          code: error.code === 'CREW_STALE_REVISION' ? 'crew-conflict' : 'crew-rejected',
          message: error.message,
        },
      }
    }
  }

  /**
   * Expose current Crew state to package-owned runtime modules.
   * @param root - Exact live Team Lead owning the Crew Session.
   * @returns Authoritative current Crew projection state.
   */
  stateFor(root: Agent): CrewProjectionState {
    return this.journal.state(root)
  }

  private async provisionDeveloper(
    root: Agent,
    current: CrewWorkItemSnapshot,
    signal: AbortSignal,
    reason = 'Native developer provisioned.',
  ): Promise<CrewWorkItemSnapshot> {
    const state = this.journal.state(root)
    const configuration = state.configuration
    if (configuration === undefined) throw new CrewError('Crew is not configured', 'CREW_NOT_CONFIGURED')
    const childId = SessionId(randomUUID())
    const attempt = current.attempt + (current.stage === 'planned' ? 0 : 1)
    const name = workerName('developer', current.moduleKey, attempt, childId)
    let reserved: CrewWorkItemSnapshot
    if (current.stage === 'planned' || current.stage === 'paused' || current.stage === 'failed') {
      reserved = await this.updateWorkItem(root, {
        taskId: current.taskId,
        expectedRevision: current.revision,
        stage: 'queued',
        reason: crewText(reason, 'reassign reason', 2_000),
        developerName: name,
        developerSessionId: childId,
        appendWorkerSessionId: childId,
        attempt,
      })
    } else if (current.stage === 'revision_required') {
      reserved = await this.updateWorkItem(root, {
        taskId: current.taskId,
        expectedRevision: current.revision,
        stage: 'running',
        reason: crewText(reason, 'reassign reason', 2_000),
        developerName: name,
        developerSessionId: childId,
        appendWorkerSessionId: childId,
        attempt,
      })
    } else {
      throw new CrewError(`Crew cannot provision a developer from "${current.stage}"`, 'CREW_INVALID_TRANSITION')
    }
    const promptSource: MessageSource = {
      kind: 'crew-worker',
      role: 'developer',
      teamId: state.id,
      taskId: reserved.taskId,
      workItemRevision: reserved.revision,
    }
    try {
      await this.ctx.agentTeams.spawnTeammate(root, {
        childId,
        name,
        description: `Developer for ${reserved.moduleKey}`,
        prompt: [{ type: 'text', text: developerPrompt(reserved, configuration.sharedDirectories) }],
        promptSource,
        context: 'fresh',
        provider: configuration.nativeProvider,
        agentOptions: this.workerOptions('developer', configuration),
        persona: configuration.roles.developer.persona,
        toolFilter: configuration.roles.developer.toolFilter,
        maxDepth: configuration.roles.developer.maxDepth,
        signal: this.operationSignal(signal),
      })
      const task = this.ctx.agentTeams.getTask(root, reserved.taskId)
      await this.ctx.agentTeams.updateTask(root, {
        taskId: task.id,
        expectedRevision: task.revision,
        action: 'reassign',
        owner: name,
      })
      if (reserved.stage === 'queued') {
        reserved = await this.updateWorkItem(root, {
          taskId: reserved.taskId,
          expectedRevision: reserved.revision,
          stage: 'running',
          reason: 'Native developer is running.',
        })
      }
    } catch (error: unknown) {
      try {
        const latest = this.journal.state(root).workItems.find(item => item.taskId === reserved.taskId)
        if (latest !== undefined && (latest.stage === 'queued' || latest.stage === 'running')) {
          const failed = await this.updateWorkItem(root, {
            taskId: latest.taskId,
            expectedRevision: latest.revision,
            stage: 'failed',
            reason: `Developer provisioning failed: ${errorMessage(error)}`,
          })
          this.queueWorkNotification(root, failed)
        }
      } catch (recordError: unknown) {
        throw new AggregateError([error, recordError], 'Crew developer provisioning and failure recording both failed')
      }
      throw error
    }
    const terminal = this.terminalEnds.get(childId)
    if (terminal !== undefined) this.scheduleTerminal(root, terminal)
    return reserved
  }

  private requireWork(root: Agent, taskId: CrewWorkItemSnapshot['taskId'], expectedRevision?: number): CrewWorkItemSnapshot {
    const work = this.journal.state(root).workItems.find(item => item.taskId === taskId)
    if (work === undefined) throw new CrewError(`Crew work item "${taskId}" not found`, 'CREW_WORK_ITEM_NOT_FOUND')
    if (expectedRevision !== undefined && work.revision !== expectedRevision) {
      throw new CrewError(
        `stale Crew work item "${taskId}" revision ${expectedRevision}; current revision is ${work.revision}`,
        'CREW_STALE_REVISION',
      )
    }
    return work
  }

  private operationSignal(signal: AbortSignal): AbortSignal {
    if (this.disposed) throw new CrewError('Crew service disposed', 'CREW_DISPOSED')
    return AbortSignal.any([signal, this.lifecycle.signal])
  }

  private host(configuration: CrewConfigurationSnapshot): CrewHost {
    return new CrewHost(this.ctx, configuration.execution)
  }

  private assertHostServices(): void {
    if (this.ctx.get('fs') === undefined || this.ctx.get('subprocess') === undefined) {
      throw new CrewError('Crew operation requires filesystem and subprocess providers', 'CREW_INVALID_CONFIG')
    }
  }

  private async pauseAfterDeliveryFailure(root: Agent, current: CrewWorkItemSnapshot, error: unknown): Promise<void> {
    const latest = this.journal.state(root).workItems.find(item => item.taskId === current.taskId)
    if (latest?.stage !== 'running') return
    const paused = await this.updateWorkItem(root, {
      taskId: latest.taskId,
      expectedRevision: latest.revision,
      stage: 'paused',
      reason: `Developer continuation failed: ${errorMessage(error)}`,
    })
    this.queueWorkNotification(root, paused)
  }

  private ownsWorker(parentSessionId: SessionId, childSessionId: SessionId): boolean {
    const root = this.ctx.get('agents')?.get(parentSessionId)
    if (root === undefined) return false
    const state = this.ctx.get('sessionProjections')?.stateOf(root.session, 'crew')
    if (state === undefined || state.failure !== undefined) return false
    return state.workItems.some(item => item.workerSessionIds.includes(childSessionId))
      || state.integrations.some(item => item.integratorSessionId === childSessionId)
  }

  private observeTerminal(root: Agent, info: SubagentRunEndInfo): void {
    if (!this.ownsWorker(root.id, info.id)) return
    this.terminalEnds.set(info.id, info)
    if (!this.intentionalStops.has(info.id)) this.scheduleTerminal(root, info)
  }

  private scheduleTerminal(root: Agent, info: SubagentRunEndInfo): void {
    if (this.terminalProcessing.has(info.id)) {
      this.terminalReschedule.add(info.id)
      return
    }
    this.terminalProcessing.add(info.id)
    this.runBackground(async () => {
      try {
        await this.handleTerminal(root, info)
      } finally {
        this.terminalProcessing.delete(info.id)
        if (this.terminalReschedule.delete(info.id)) this.scheduleTerminal(root, info)
      }
    })
  }

  private scheduleRecovery(agent: Agent): void {
    queueMicrotask(() => {
      if (this.disposed || agent.session.header.parentSession !== undefined) return
      if (this.recoveringRoots.has(agent.id)) {
        this.recoveryRequested.add(agent.id)
        return
      }
      this.recoveringRoots.add(agent.id)
      this.runBackground(async () => {
        try {
          await this.recoverRoot(agent)
        } finally {
          this.recoveringRoots.delete(agent.id)
          if (this.recoveryRequested.delete(agent.id)) this.scheduleRecovery(agent)
        }
      })
    })
  }

  private runBackground(operation: () => Promise<void>): void {
    if (this.disposed) return
    const task = operation().catch((error: unknown) => {
      if (!this.disposed) this.ctx.logger.warn(`Crew background operation failed: ${errorMessage(error)}`)
    }).finally(() => { this.background.delete(task) })
    this.background.add(task)
  }

  private queueWorkNotification(root: Agent, workItem: CrewWorkItemSnapshot): void {
    const event = root.session.snapshotEvents().findLast(candidate => candidate.type === 'crew/work-item'
      && String(candidate.data.teamId) === String(root.id)
      && candidate.data.workItem.taskId === workItem.taskId
      && candidate.data.workItem.revision === workItem.revision)
    if (event !== undefined) this.queueNotificationSource(root, event.seq)
  }

  private queueIntegrationNotification(root: Agent, integration: CrewIntegrationSnapshot): void {
    const event = root.session.snapshotEvents().findLast(candidate => candidate.type === 'crew/integration'
      && String(candidate.data.teamId) === String(root.id)
      && candidate.data.integration.id === integration.id
      && candidate.data.integration.revision === integration.revision)
    if (event !== undefined) this.queueNotificationSource(root, event.seq)
  }

  private queueNotificationSource(root: Agent, seq: SessionEvent['seq']): void {
    if (this.disposed) return
    const existing = this.notificationBatches.get(root.id)
    if (existing !== undefined) {
      existing.sourceSeqs.add(seq)
      return
    }
    const configuration = this.journal.state(root).configuration
    if (configuration === undefined) return
    const sourceSeqs = new Set([seq])
    const timer = setTimeout(() => {
      this.notificationBatches.delete(root.id)
      this.runBackground(async () => { await this.flushNotificationBatch(root, [...sourceSeqs]) })
    }, configuration.notificationBatchWindowMs)
    this.notificationBatches.set(root.id, { root, sourceSeqs, timer })
  }

  private async flushNotificationBatch(root: Agent, candidates: readonly SessionEvent['seq'][]): Promise<void> {
    const notification = await this.journal.transact(root.id, async () => {
      const state = this.journal.state(root)
      const notified = new Set(state.notifications.flatMap(item => item.sourceEventSeqs))
      const sourceEventSeqs = [...new Set(candidates)]
        .filter(seq => !notified.has(seq) && this.actionableSourceIsCurrent(root, seq))
        .sort((left, right) => left - right)
      if (sourceEventSeqs.length === 0) return undefined
      const content = renderNotificationContent(root.session.snapshotEvents(), sourceEventSeqs)
      const notification: CrewNotificationSnapshot = {
        id: brandString<CrewNotificationId>(randomUUID()),
        revision: 1,
        sourceEventSeqs,
        content,
        status: 'queued',
        deliveryMessageId: MessageId(randomUUID()),
      }
      await this.journal.appendAndFlush(root, 'crew/notification', {
        version: 1,
        teamId: state.id,
        notification,
      })
      return notification
    })
    if (notification !== undefined) this.scheduleNotificationDelivery(root)
  }

  private actionableSourceIsCurrent(root: Agent, seq: SessionEvent['seq']): boolean {
    const event = root.session.snapshotEvents()[seq]
    const state = this.journal.state(root)
    if (event?.type === 'crew/work-item') {
      const workItem = event.data.workItem
      const current = state.workItems.find(item => item.taskId === workItem.taskId)
      return current?.revision === workItem.revision
        && ['integration_ready', 'paused', 'failed'].includes(workItem.stage)
    }
    if (event?.type === 'crew/integration') {
      const integration = event.data.integration
      const current = state.integrations.find(item => item.id === integration.id)
      return current?.revision === integration.revision
        && (integration.status === 'passed' || integration.status === 'failed')
    }
    return false
  }

  private scheduleNotificationDelivery(root: Agent): void {
    if (this.disposed || this.deliveringNotifications.has(root.id)) return
    this.deliveringNotifications.add(root.id)
    this.runBackground(async () => {
      try {
        await this.deliverOneNotification(root)
      } finally {
        this.deliveringNotifications.delete(root.id)
      }
    })
  }

  private async deliverOneNotification(root: Agent): Promise<void> {
    if (root.status !== 'idle') return
    const notification = this.journal.state(root).notifications.find(item => item.status === 'queued')
    if (notification === undefined) return
    if (!messageObserved(root, notification.deliveryMessageId)) {
      const message = freezeMessage({
        id: notification.deliveryMessageId,
        role: 'user' as const,
        content: [{ type: 'text' as const, text: notification.content }],
        source: { kind: 'crew-notification' as const, notificationId: notification.id },
      })
      root.followup(message)
      await this.ctx.sessions.flush(root.session)
    }
    await this.journal.transact(root.id, async () => {
      const current = this.journal.state(root).notifications.find(item => item.id === notification.id)
      if (current?.status !== 'queued' || current.revision !== notification.revision) return
      await this.journal.appendAndFlush(root, 'crew/notification', {
        version: 1,
        teamId: this.journal.state(root).id,
        notification: { ...current, revision: current.revision + 1, status: 'delivered' },
      })
    })
  }

  private async handleTerminal(root: Agent, info: SubagentRunEndInfo): Promise<void> {
    const state = this.journal.state(root)
    const developer = state.workItems.find(item => item.developerSessionId === info.id && item.stage === 'running')
    if (developer !== undefined) {
      await this.settleDeveloper(root, developer, info)
      this.terminalEnds.delete(info.id)
      return
    }
    const reviewer = state.workItems.find(item => item.reviewerSessionId === info.id && item.stage === 'reviewing')
    if (reviewer !== undefined) {
      await this.settleReviewer(root, reviewer, info)
      this.terminalEnds.delete(info.id)
      return
    }
    const integration = state.integrations.find(item => item.integratorSessionId === info.id && item.status === 'running')
    if (integration !== undefined) {
      await this.settleIntegrator(root, integration, info)
      this.terminalEnds.delete(info.id)
    }
  }

  private async recoverRoot(root: Agent): Promise<void> {
    const state = this.ctx.get('sessionProjections')?.stateOf(root.session, 'crew')
    if (state === undefined || state.configuration === undefined || state.failure !== undefined) return
    const nativeProvider = state.configuration.nativeProvider
    this.scheduleNotificationDelivery(root)
    const notified = new Set(state.notifications.flatMap(item => item.sourceEventSeqs))
    for (const event of root.session.snapshotEvents()) {
      if (!notified.has(event.seq) && this.actionableSourceIsCurrent(root, event.seq)) {
        this.queueNotificationSource(root, event.seq)
      }
    }
    for (const workItem of state.workItems) {
      if (workItem.stage === 'queued') await this.recoverQueuedDeveloper(root, workItem)
      if (workItem.stage === 'verifying' && !this.managerIntegrations.has(root.id)
        && state.reports.find(item => item.id === workItem.latestReportId)?.workerSessionId === root.id) {
        await this.updateWorkItem(root, {
          taskId: workItem.taskId, expectedRevision: workItem.revision, stage: 'paused',
          reason: 'Manager verification was interrupted. Files are retained; verify the current checkout again.',
        })
      }
    }
    const refreshed = this.journal.state(root)
    for (const workItem of refreshed.workItems) {
      if (workItem.stage === 'running' && workItem.developerSessionId !== undefined) {
        await this.recoverWorkerTurn(root, workItem.developerSessionId, {
          role: 'developer',
          taskId: workItem.taskId,
          revision: workItem.revision,
        }, nativeProvider)
      }
      if (workItem.stage === 'reviewing' && workItem.reviewerSessionId !== undefined) {
        await this.recoverReviewerProvisioning(root, workItem)
        const latest = this.journal.state(root).workItems.find(item => item.taskId === workItem.taskId)
        if (latest?.stage === 'reviewing' && latest.reviewerSessionId !== undefined) {
          await this.recoverWorkerTurn(root, latest.reviewerSessionId, {
            role: 'reviewer',
            taskId: latest.taskId,
            revision: latest.revision,
          }, nativeProvider)
        }
      }
    }
    for (const integration of this.journal.state(root).integrations.filter(item => item.status === 'running')) {
      if (integration.execution === 'manager') {
        if (!this.managerIntegrations.has(root.id)) await this.publishIntegrationTerminal(root, integration, {
          ...integration, revision: integration.revision + 1, status: 'failed',
          summary: 'Manager integration was interrupted. Files are retained; review and verify them again.',
        })
        continue
      }
      await this.recoverIntegratorProvisioning(root, integration)
      const latest = this.journal.state(root).integrations.find(item => item.id === integration.id)
      if (latest?.status === 'running') {
        await this.recoverWorkerTurn(root, latest.integratorSessionId, {
          role: 'integrator',
          integrationId: latest.id,
          revision: latest.revision,
        }, nativeProvider)
      }
    }
  }

  private async recoverQueuedDeveloper(root: Agent, workItem: CrewWorkItemSnapshot): Promise<void> {
    const configuration = this.journal.state(root).configuration
    if (configuration === undefined || workItem.developerSessionId === undefined || workItem.developerName === undefined) return
    let member = this.ctx.agentTeams.listMembers(root).find(item => item.id === workItem.developerSessionId)
    if (member?.status === 'failed') {
      const failed = await this.updateWorkItem(root, {
        taskId: workItem.taskId,
        expectedRevision: workItem.revision,
        stage: 'failed',
        reason: 'Reserved developer failed during restart recovery.',
      })
      this.queueWorkNotification(root, failed)
      return
    }
    if (member === undefined) {
      await this.ctx.agentTeams.spawnTeammate(root, {
        childId: workItem.developerSessionId,
        name: workItem.developerName,
        description: `Developer for ${workItem.moduleKey}`,
        prompt: [{ type: 'text', text: developerPrompt(workItem, configuration.sharedDirectories) }],
        promptSource: workerSource(this.journal.state(root).id, workItem, 'developer'),
        context: 'fresh',
        provider: configuration.nativeProvider,
        agentOptions: this.workerOptions('developer', configuration),
        persona: configuration.roles.developer.persona,
        toolFilter: configuration.roles.developer.toolFilter,
        maxDepth: configuration.roles.developer.maxDepth,
        signal: this.lifecycle.signal,
      })
      member = this.ctx.agentTeams.listMembers(root).find(item => item.id === workItem.developerSessionId)
    }
    if (member?.status === 'provisioning') return
    const task = this.ctx.agentTeams.getTask(root, workItem.taskId)
    await this.ctx.agentTeams.updateTask(root, {
      taskId: task.id,
      expectedRevision: task.revision,
      action: 'reassign',
      owner: workItem.developerName,
    })
    await this.updateWorkItem(root, {
      taskId: workItem.taskId,
      expectedRevision: workItem.revision,
      stage: 'running',
      reason: 'Recovered reserved native developer.',
    })
  }

  private async recoverReviewerProvisioning(root: Agent, workItem: CrewWorkItemSnapshot): Promise<void> {
    const configuration = this.journal.state(root).configuration
    if (configuration === undefined || workItem.reviewerSessionId === undefined || workItem.reviewerName === undefined) return
    const member = this.ctx.agentTeams.listMembers(root).find(item => item.id === workItem.reviewerSessionId)
    if (member?.status === 'failed') {
      const failed = await this.updateWorkItem(root, {
        taskId: workItem.taskId,
        expectedRevision: workItem.revision,
        stage: 'failed',
        reason: 'Reserved reviewer failed during restart recovery.',
      })
      this.queueWorkNotification(root, failed)
      return
    }
    if (member !== undefined) return
    const verification = this.journal.state(root).verifications.find(item => item.id === workItem.latestVerificationId)
    if (verification === undefined) {
      const paused = await this.updateWorkItem(root, {
        taskId: workItem.taskId,
        expectedRevision: workItem.revision,
        stage: 'paused',
        reason: 'Reviewer recovery requires missing verification evidence.',
      })
      this.queueWorkNotification(root, paused)
      return
    }
    await this.ctx.agentTeams.spawnTeammate(root, {
      childId: workItem.reviewerSessionId,
      name: workItem.reviewerName,
      description: `Reviewer for ${workItem.moduleKey} round ${workItem.reviewRound}`,
      prompt: [{ type: 'text', text: reviewerPrompt(workItem, verification) }],
      promptSource: workerSource(this.journal.state(root).id, workItem, 'reviewer'),
      context: 'fresh',
      provider: configuration.nativeProvider,
      agentOptions: this.workerOptions('reviewer', configuration),
      persona: configuration.roles.reviewer.persona,
      toolFilter: configuration.roles.reviewer.toolFilter,
      maxDepth: configuration.roles.reviewer.maxDepth,
      signal: this.lifecycle.signal,
    })
  }

  private async recoverIntegratorProvisioning(root: Agent, integration: CrewIntegrationSnapshot): Promise<void> {
    const state = this.journal.state(root)
    const configuration = state.configuration
    if (configuration === undefined) return
    const member = this.ctx.agentTeams.listMembers(root).find(item => item.id === integration.integratorSessionId)
    if (member?.status === 'failed') {
      await this.publishIntegrationTerminal(root, integration, {
        ...integration,
        revision: integration.revision + 1,
        status: 'failed',
        summary: 'Reserved integrator failed during restart recovery.',
        stopReason: 'error',
      })
      return
    }
    if (member !== undefined) return
    const workItems = integration.inputs.map(input => this.requireWork(root, input.taskId, input.workItemRevision))
    const name = workerName('integrator', 'reviewed-set', 1, integration.integratorSessionId)
    await this.ctx.agentTeams.spawnTeammate(root, {
      childId: integration.integratorSessionId,
      name,
      description: `Integrator for ${workItems.length} reviewed work items`,
      prompt: [{ type: 'text', text: integratorPrompt(integration, workItems) }],
      promptSource: integrationSource(state.id, integration),
      context: 'fresh',
      provider: configuration.nativeProvider,
      agentOptions: this.workerOptions('integrator', configuration),
      persona: configuration.roles.integrator.persona,
      toolFilter: configuration.roles.integrator.toolFilter,
      maxDepth: configuration.roles.integrator.maxDepth,
      signal: this.lifecycle.signal,
    })
  }

  private async recoverWorkerTurn(
    root: Agent,
    childId: SessionId,
    binding: RecoveryBinding,
    provider: string,
  ): Promise<void> {
    const query = this.ctx.get('sessionQuery')
    if (query === undefined) return
    let observation
    try {
      observation = await query.observeSession(childId, { signal: this.lifecycle.signal, projectionMode: 'none' })
    } catch (error: unknown) {
      await this.parkUnrecoverableBinding(root, binding, `Worker Session cannot be read: ${errorMessage(error)}`)
      return
    }
    using source = observation
    const terminal = recoveredTerminal(source.events, childId, binding, provider)
    if (terminal !== undefined) {
      await this.handleTerminal(root, terminal)
      return
    }
    if (this.ctx.get('agents')?.get(childId) !== undefined) return
    const sourceMarker = binding.role === 'integrator'
      ? integrationRecoverySource(this.journal.state(root).id, binding)
      : workRecoverySource(this.journal.state(root).id, binding)
    await steerHostSubagentPrompt(
      this.ctx.subagents,
      root,
      childId,
      [{ type: 'text', text: 'Resume the current Crew assignment from durable state. Recheck the specification and record the required structured Crew report.' }],
      sourceMarker,
      this.lifecycle.signal,
    )
  }

  private async parkUnrecoverableBinding(root: Agent, binding: RecoveryBinding, reason: string): Promise<void> {
    if (binding.role === 'integrator') {
      const integration = this.journal.state(root).integrations.find(item => item.id === binding.integrationId)
      if (integration?.status === 'running' && integration.revision === binding.revision) {
        await this.publishIntegrationTerminal(root, integration, {
          ...integration,
          revision: integration.revision + 1,
          status: 'failed',
          summary: reason,
          stopReason: 'error',
        })
      }
      return
    }
    const workItem = this.journal.state(root).workItems.find(item => item.taskId === binding.taskId)
    if (workItem?.revision !== binding.revision) return
    const parked = await this.updateWorkItem(root, {
      taskId: workItem.taskId,
      expectedRevision: workItem.revision,
      stage: 'paused',
      reason,
    })
    this.queueWorkNotification(root, parked)
  }

  private async settleDeveloper(
    root: Agent,
    workItem: CrewWorkItemSnapshot,
    terminal: SubagentRunEndInfo,
  ): Promise<void> {
    const report = await this.terminalReport(root, workItem, 'developer', terminal)
    const verifying = await this.updateWorkItem(root, {
      taskId: workItem.taskId,
      expectedRevision: workItem.revision,
      stage: 'verifying',
      reason: 'Developer handoff entered host verification.',
      latestReportId: report.id,
    })
    const state = this.journal.state(root)
    const configuration = state.configuration
    if (configuration === undefined) throw new CrewError('Crew is not configured', 'CREW_NOT_CONFIGURED')
    const startedAt = Date.now()
    const beforeTests = await this.host(configuration).inspectCheckout(configuration.repositoryRoot, this.lifecycle.signal)
    const commands: CrewCommandResult[] = []
    if (terminal.stopReason === 'completed' && report.verdict === 'ready') {
      for (const command of verifying.testCommands) {
        commands.push(await this.host(configuration).runCommand(configuration.repositoryRoot, command, this.lifecycle.signal))
      }
    }
    const checkout = commands.length === 0
      ? beforeTests
      : await this.host(configuration).inspectCheckout(configuration.repositoryRoot, this.lifecycle.signal)
    const changedPaths = changedSince(verifying.baseline, checkout)
    const crewScopes = [
      ...this.journal.state(root).workItems.flatMap(item => item.writeScopes),
      ...configuration.sharedDirectories,
    ]
    const outOfScopePaths = changedPaths.filter(path => !crewScopes.some(scope => pathInCrewScope(path, scope)))
    const reportedSharedPaths = report.changedPaths.filter(path => (
      configuration.sharedDirectories.some(scope => pathInCrewScope(path, scope))
    ))
    const workPaths = [...new Set([
      ...changedPaths.filter(path => verifying.writeScopes.some(scope => pathInCrewScope(path, scope))),
      ...reportedSharedPaths,
    ])].sort()
    const reportedPathsMatch = sameStringSet(report.changedPaths, workPaths)
      && reportedSharedPaths.every(path => changedPaths.includes(path))
    const missingArtifacts = await this.host(configuration).missingArtifacts(
      configuration.repositoryRoot,
      verifying.requiredArtifacts,
      this.lifecycle.signal,
    )
    const failures = [
      ...(terminal.stopReason === 'completed' ? [] : [`worker stopped with ${terminal.stopReason}`]),
      ...(report.verdict === 'ready' ? [] : [`worker reported ${report.verdict}`]),
      ...(checkout.head === verifying.baseline.head ? [] : ['repository HEAD changed']),
      ...(checkout.stagedPaths.length === 0 ? [] : ['worker checkout contains staged paths']),
      ...(sameWorkCheckout(beforeTests, checkout, verifying, report.changedPaths) ? [] : ['module inputs changed during declared tests']),
      ...(outOfScopePaths.length === 0 ? [] : [`paths escaped Crew scopes: ${outOfScopePaths.join(', ')}`]),
      ...(reportedPathsMatch ? [] : ['reported paths do not match host-observed module paths']),
      ...(missingArtifacts.length === 0 ? [] : [`required artifacts are missing: ${missingArtifacts.join(', ')}`]),
      ...commands.filter(command => command.timedOut || command.exitCode !== 0)
        .map(command => `test ${command.commandId} failed`),
    ]
    const verification: CrewVerificationSnapshot = {
      id: brandString<CrewVerificationId>(randomUUID()),
      taskId: verifying.taskId,
      reportId: report.id,
      workerSessionId: terminal.id,
      specRevision: verifying.specRevision,
      startedAt,
      finishedAt: Date.now(),
      workerStopReason: terminal.stopReason,
      checkout,
      changedPaths: workPaths,
      outOfScopePaths,
      missingArtifacts,
      commands,
      verdict: failures.length === 0 ? 'passed' : 'failed',
      summary: failures.length === 0 ? 'Host verification passed.' : failures.join('; '),
    }
    await this.publishVerification(root, verifying, verification)
    if (verification.verdict === 'passed') {
      if (verifying.reviewMode === 'manager') {
        const task = this.ctx.agentTeams.getTask(root, verifying.taskId)
        await this.ctx.agentTeams.updateTask(root, { taskId: task.id, expectedRevision: task.revision, action: 'complete' })
        const ready = await this.updateWorkItem(root, {
          taskId: verifying.taskId, expectedRevision: verifying.revision,
          stage: 'integration_ready', reason: 'Host verification passed; manager review and integration are pending.',
          latestVerificationId: verification.id,
        })
        this.queueWorkNotification(root, ready)
        return
      }
      await this.launchReviewer(root, verifying, report, verification)
      return
    }
    if (verifying.automaticRepairCount < configuration.maxAutomaticRepairs) {
      const revisionRequired = await this.updateWorkItem(root, {
        taskId: verifying.taskId,
        expectedRevision: verifying.revision,
        stage: 'revision_required',
        reason: verification.summary,
        automaticRepairCount: verifying.automaticRepairCount + 1,
        latestVerificationId: verification.id,
      })
      await this.append(root, {
        taskId: revisionRequired.taskId,
        expectedRevision: revisionRequired.revision,
        message: `Host verification failed. Repair the same work item and report again.\n${verification.summary}`,
        signal: this.lifecycle.signal,
      })
      return
    }
    const paused = await this.updateWorkItem(root, {
      taskId: verifying.taskId,
      expectedRevision: verifying.revision,
      stage: 'paused',
      reason: verification.summary,
      latestVerificationId: verification.id,
    })
    this.queueWorkNotification(root, paused)
  }

  private async settleReviewer(
    root: Agent,
    workItem: CrewWorkItemSnapshot,
    terminal: SubagentRunEndInfo,
  ): Promise<void> {
    const report = await this.terminalReport(root, workItem, 'reviewer', terminal)
    const verificationId = workItem.latestVerificationId
    if (verificationId === undefined) {
      throw new CrewError('reviewing work item lacks current verification evidence', 'CREW_EVIDENCE_NOT_FOUND')
    }
    const state = this.journal.state(root)
    const configuration = state.configuration
    const verification = state.verifications.find(item => item.id === verificationId)
    if (configuration === undefined || verification === undefined) {
      throw new CrewError('reviewing work item lacks frozen checkout evidence', 'CREW_EVIDENCE_NOT_FOUND')
    }
    const checkout = await this.host(configuration).inspectCheckout(configuration.repositoryRoot, this.lifecycle.signal)
    const checkoutMatches = sameWorkCheckout(verification.checkout, checkout, workItem, verification.changedPaths)
      && checkout.stagedPaths.length === 0
    const passed = terminal.stopReason === 'completed'
      && checkoutMatches
      && report.verdict === 'passed'
      && report.issues.length === 0
      && report.verificationId === verificationId
    const review: CrewReviewSnapshot = {
      id: brandString<CrewReviewId>(randomUUID()),
      taskId: workItem.taskId,
      reportId: report.id,
      reviewerSessionId: terminal.id,
      specRevision: workItem.specRevision,
      verificationId,
      round: workItem.reviewRound,
      verdict: passed ? 'passed' : 'rejected',
      issues: structuredClone(report.issues),
      summary: passed
        ? report.summary
        : !checkoutMatches
          ? 'Module inputs changed after host verification.'
          : report.summary || `Reviewer stopped with ${terminal.stopReason}.`,
      stopReason: terminal.stopReason,
    }
    await this.publishReview(root, workItem, review)
    if (passed) {
      const task = this.ctx.agentTeams.getTask(root, workItem.taskId)
      await this.ctx.agentTeams.updateTask(root, {
        taskId: task.id,
        expectedRevision: task.revision,
        action: 'complete',
      })
      const ready = await this.updateWorkItem(root, {
        taskId: workItem.taskId,
        expectedRevision: workItem.revision,
        stage: 'integration_ready',
        reason: 'Host verification and reviewer passed.',
        latestReportId: report.id,
        latestReviewId: review.id,
      })
      this.queueWorkNotification(root, ready)
      return
    }
    if (workItem.reviewRound < configuration.maxReviewRounds) {
      const revisionRequired = await this.updateWorkItem(root, {
        taskId: workItem.taskId,
        expectedRevision: workItem.revision,
        stage: 'revision_required',
        reason: review.summary,
        latestReportId: report.id,
        latestReviewId: review.id,
      })
      const issueText = review.issues.length === 0
        ? review.summary
        : review.issues.map(issue => `${issue.path}${issue.line === undefined ? '' : `:${issue.line}`}: ${issue.message}; expected ${issue.expected}`).join('\n')
      await this.append(root, {
        taskId: revisionRequired.taskId,
        expectedRevision: revisionRequired.revision,
        message: `Reviewer rejected the handoff. Revise the same work item and report again.\n${issueText}`,
        signal: this.lifecycle.signal,
      })
      return
    }
    const paused = await this.updateWorkItem(root, {
      taskId: workItem.taskId,
      expectedRevision: workItem.revision,
      stage: 'paused',
      reason: `Review round limit reached: ${review.summary}`,
      latestReportId: report.id,
      latestReviewId: review.id,
    })
    this.queueWorkNotification(root, paused)
  }

  private async terminalReport(
    root: Agent,
    workItem: CrewWorkItemSnapshot,
    role: 'developer' | 'reviewer',
    terminal: SubagentRunEndInfo,
  ): Promise<CrewReportSnapshot> {
    const existing = this.journal.state(root).reports.findLast(report => report.taskId === workItem.taskId
      && report.workItemRevision === workItem.revision
      && report.role === role
      && report.workerSessionId === terminal.id)
    if (existing !== undefined) return existing
    const report: CrewReportSnapshot = {
      id: brandString<CrewReportId>(randomUUID()),
      taskId: workItem.taskId,
      workItemRevision: workItem.revision,
      role,
      workerSessionId: terminal.id,
      specRevision: workItem.specRevision,
      ...(role === 'reviewer' && workItem.latestVerificationId !== undefined
        ? { verificationId: workItem.latestVerificationId }
        : {}),
      verdict: role === 'developer' ? 'blocked' : 'rejected',
      summary: `Worker ended with ${terminal.stopReason} without a structured Crew report.`,
      changedPaths: [],
      issues: [],
    }
    await this.journal.transact(root.id, async () => {
      const latest = this.requireWork(root, workItem.taskId, workItem.revision)
      const expectedId = role === 'developer' ? latest.developerSessionId : latest.reviewerSessionId
      if (expectedId !== terminal.id) throw new CrewError('terminal worker binding is stale', 'CREW_STALE_REVISION')
      await this.journal.appendAndFlush(root, 'crew/report', {
        version: 1,
        teamId: this.journal.state(root).id,
        report,
      })
    })
    return report
  }

  private async publishVerification(
    root: Agent,
    workItem: CrewWorkItemSnapshot,
    verification: CrewVerificationSnapshot,
  ): Promise<void> {
    await this.journal.transact(root.id, async () => {
      this.requireWork(root, workItem.taskId, workItem.revision)
      await this.journal.appendAndFlush(root, 'crew/verification', {
        version: 1,
        teamId: this.journal.state(root).id,
        verification,
      })
    })
  }

  private async publishReview(
    root: Agent,
    workItem: CrewWorkItemSnapshot,
    review: CrewReviewSnapshot,
  ): Promise<void> {
    await this.journal.transact(root.id, async () => {
      this.requireWork(root, workItem.taskId, workItem.revision)
      await this.journal.appendAndFlush(root, 'crew/review', {
        version: 1,
        teamId: this.journal.state(root).id,
        review,
      })
    })
  }

  private async launchReviewer(
    root: Agent,
    workItem: CrewWorkItemSnapshot,
    report: CrewReportSnapshot,
    verification: CrewVerificationSnapshot,
  ): Promise<CrewWorkItemSnapshot> {
    const state = this.journal.state(root)
    const configuration = state.configuration
    if (configuration === undefined) throw new CrewError('Crew is not configured', 'CREW_NOT_CONFIGURED')
    const childId = SessionId(randomUUID())
    const round = workItem.reviewRound + 1
    const name = workerName('reviewer', workItem.moduleKey, round, childId)
    const reviewing = await this.updateWorkItem(root, {
      taskId: workItem.taskId,
      expectedRevision: workItem.revision,
      stage: 'reviewing',
      reason: 'Read-only reviewer provisioned.',
      reviewerName: name,
      reviewerSessionId: childId,
      appendWorkerSessionId: childId,
      reviewRound: round,
      latestReportId: report.id,
      latestVerificationId: verification.id,
    })
    try {
      await this.ctx.agentTeams.spawnTeammate(root, {
        childId,
        name,
        description: `Reviewer for ${reviewing.moduleKey} round ${round}`,
        prompt: [{ type: 'text', text: reviewerPrompt(reviewing, verification) }],
        promptSource: {
          kind: 'crew-worker',
          role: 'reviewer',
          teamId: state.id,
          taskId: reviewing.taskId,
          workItemRevision: reviewing.revision,
        },
        context: 'fresh',
        provider: configuration.nativeProvider,
        agentOptions: this.workerOptions('reviewer', configuration),
        persona: configuration.roles.reviewer.persona,
        toolFilter: configuration.roles.reviewer.toolFilter,
        maxDepth: configuration.roles.reviewer.maxDepth,
        signal: this.lifecycle.signal,
      })
    } catch (error: unknown) {
      const failed = await this.updateWorkItem(root, {
        taskId: reviewing.taskId,
        expectedRevision: reviewing.revision,
        stage: 'failed',
        reason: `Reviewer provisioning failed: ${errorMessage(error)}`,
      })
      this.queueWorkNotification(root, failed)
      throw error
    }
    const terminal = this.terminalEnds.get(childId)
    if (terminal !== undefined) this.scheduleTerminal(root, terminal)
    return reviewing
  }

  private async settleIntegrator(
    root: Agent,
    integration: CrewIntegrationSnapshot,
    terminal: SubagentRunEndInfo,
  ): Promise<void> {
    const report = await this.terminalIntegrationReport(root, integration, terminal)
    const state = this.journal.state(root)
    const configuration = state.configuration
    if (configuration === undefined) throw new CrewError('Crew is not configured', 'CREW_NOT_CONFIGURED')
    const beforeTests = await this.host(configuration).inspectCheckout(configuration.repositoryRoot, this.lifecycle.signal)
    const workItems = integration.inputs.map(input => this.requireWork(root, input.taskId, input.workItemRevision))
    const commands: CrewCommandResult[] = []
    const integrationPaths = changedSince(integration.inputCheckout, beforeTests)
    if (terminal.stopReason === 'completed' && report.verdict === 'passed' && report.issues.length === 0
      && sameStringSet(report.changedPaths, integrationPaths)) {
      for (const command of integration.testCommands) {
        commands.push(await this.host(configuration).runCommand(configuration.repositoryRoot, command, this.lifecycle.signal))
      }
    }
    const checkout = commands.length === 0
      ? beforeTests
      : await this.host(configuration).inspectCheckout(configuration.repositoryRoot, this.lifecycle.signal)
    const approvedPaths = [...new Set([
      ...integration.inputs.flatMap(input => state.verifications.find(item => item.id === input.verificationId)?.changedPaths ?? []),
      ...integrationPaths,
    ])].sort()
    const failures = [
      ...(terminal.stopReason === 'completed' ? [] : [`integrator stopped with ${terminal.stopReason}`]),
      ...(report.verdict === 'passed' ? [] : [`integrator reported ${report.verdict}`]),
      ...(report.issues.length === 0 ? [] : [`integrator reported ${report.issues.length} issue(s)`]),
      ...(workItems.every(item => item.stage === 'integration_ready') ? [] : ['an integration input changed stage']),
      ...(workItems.every(item => item.baseline.head === checkout.head) ? [] : ['repository HEAD changed']),
      ...(checkout.stagedPaths.length === 0 ? [] : ['integration checkout contains staged paths']),
      ...(integration.inputCheckout.branch === checkout.branch ? [] : ['repository branch changed']),
      ...(sameStringSet(report.changedPaths, integrationPaths) ? [] : ['reported integration paths do not match observed changes']),
      ...(sameCheckoutWorld(beforeTests, checkout) ? [] : ['integration checkout changed during combined tests']),
      ...commands.filter(command => command.timedOut || command.exitCode !== 0)
        .map(command => `integration test ${command.commandId} failed`),
    ]
    const terminalIntegration: CrewIntegrationSnapshot = {
      ...integration,
      revision: integration.revision + 1,
      status: failures.length === 0 ? 'passed' : 'failed',
      commands,
      issues: structuredClone(report.issues),
      summary: failures.length === 0 ? report.summary : failures.join('; '),
      stopReason: terminal.stopReason,
      ...(failures.length === 0 ? { checkout, approvedPaths } : {}),
    }
    await this.publishIntegrationTerminal(root, integration, terminalIntegration)
    if (terminalIntegration.status !== 'passed') return
    for (const workItem of workItems) {
      await this.updateWorkItem(root, {
        taskId: workItem.taskId,
        expectedRevision: workItem.revision,
        stage: 'accepted',
        reason: 'Accepted by current passing integration.',
        acceptedIntegrationId: terminalIntegration.id,
      })
    }
  }

  private async terminalIntegrationReport(
    root: Agent,
    integration: CrewIntegrationSnapshot,
    terminal: SubagentRunEndInfo,
  ): Promise<CrewReportSnapshot> {
    const existing = this.journal.state(root).reports.findLast(report => report.integrationId === integration.id
      && report.integrationRevision === integration.revision
      && report.role === 'integrator'
      && report.workerSessionId === terminal.id)
    if (existing !== undefined) return existing
    const report: CrewReportSnapshot = {
      id: brandString<CrewReportId>(randomUUID()),
      integrationId: integration.id,
      integrationRevision: integration.revision,
      role: 'integrator',
      workerSessionId: terminal.id,
      verdict: 'rejected',
      summary: `Integrator ended with ${terminal.stopReason} without a structured Crew report.`,
      changedPaths: [],
      issues: [],
    }
    await this.journal.transact(root.id, async () => {
      const latest = this.journal.state(root).integrations.find(item => item.id === integration.id)
      if (latest?.revision !== integration.revision || latest.status !== 'running') {
        throw new CrewError('terminal integration binding is stale', 'CREW_STALE_REVISION')
      }
      await this.journal.appendAndFlush(root, 'crew/report', {
        version: 1,
        teamId: this.journal.state(root).id,
        report,
      })
    })
    return report
  }

  private async publishIntegrationTerminal(
    root: Agent,
    current: CrewIntegrationSnapshot,
    terminal: CrewIntegrationSnapshot,
  ): Promise<void> {
    await this.journal.transact(root.id, async () => {
      const latest = this.journal.state(root).integrations.find(item => item.id === current.id)
      if (latest?.revision !== current.revision || latest.status !== 'running') {
        throw new CrewError('Crew integration revision changed before settlement', 'CREW_STALE_REVISION')
      }
      await this.journal.appendAndFlush(root, 'crew/integration', {
        version: 1,
        teamId: this.journal.state(root).id,
        integration: terminal,
      })
    })
    this.queueIntegrationNotification(root, terminal)
  }

  private workerAccess(caller: Agent): CrewWorkerAccess {
    this.assertHostServices()
    const binding = this.workerBinding(caller)
    const root = this.ctx.get('agents')?.get(binding.rootSessionId)
    if (root === undefined) throw new CrewError('Crew manager is not live', 'CREW_UNAUTHORIZED_WORKER')
    const state = this.journal.state(root)
    const configuration = state.configuration
    if (configuration === undefined) throw new CrewError('Crew is not configured', 'CREW_NOT_CONFIGURED')
    if (binding.role === 'integrator') {
      const integration = state.integrations.find(item => item.id === binding.integrationId)
      if (integration === undefined) throw new CrewError('Crew integration is absent', 'CREW_EVIDENCE_NOT_FOUND')
      return {
        root,
        configuration,
        binding,
        readScopes: undefined,
        writeScopes: undefined,
      }
    }
    const workItem = this.requireWork(root, binding.taskId, binding.workItemRevision)
    return {
      root,
      configuration,
      binding,
      readScopes: binding.role === 'reviewer' ? undefined
        : [...new Set([...workItem.readScopes, ...workItem.writeScopes, workItem.specPath, ...configuration.sharedDirectories])],
      writeScopes: binding.role === 'developer' ? [...workItem.writeScopes, ...configuration.sharedDirectories] : [],
      workItem,
    }
  }

  /** New workers resolve user defaults once; continuations retain their existing descriptor. */
  private workerOptions(role: CrewWorkerRole, configuration: CrewConfigurationSnapshot): AgentOptions {
    const base = configuration.roles[role].agentOptions
    return agentOptions(this.ctx.get('crewPreferences')?.resolveRole(role, base) ?? base)
  }

  private assertBindingCurrent(root: Agent, caller: Agent, expected: CrewWorkerBinding): void {
    const actual = this.workerBinding(caller)
    if (actual.rootSessionId !== root.id || JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new CrewError('Crew worker binding changed before report commit', 'CREW_STALE_REVISION')
    }
  }

  private assertReportVerdict(role: CrewWorkerRole, verdict: CrewReportSnapshot['verdict']): void {
    const valid = role === 'developer'
      ? verdict === 'ready' || verdict === 'blocked'
      : verdict === 'passed' || verdict === 'rejected'
    if (!valid) throw new CrewError(`Crew ${role} cannot report verdict "${verdict}"`, 'CREW_INVALID_TRANSITION')
  }

  private assertTeamTaskStage(task: TeamTaskView, stage: CrewStage): void {
    const expectsCompleted = stage === 'integration_ready' || stage === 'accepted'
    const expectsInProgress = stage === 'running'
      || stage === 'reviewing'
      || stage === 'revision_required'
    if (expectsCompleted && task.status !== 'completed') {
      throw new CrewError(`Crew stage "${stage}" requires a completed Team task`, 'CREW_TEAM_TASK_MISMATCH')
    }
    if (expectsInProgress && task.status !== 'in_progress') {
      throw new CrewError(`Crew stage "${stage}" requires an in-progress Team task`, 'CREW_TEAM_TASK_MISMATCH')
    }
    if (task.status === 'deleted') {
      throw new CrewError(`Team task "${task.id}" is deleted`, 'CREW_TEAM_TASK_MISMATCH')
    }
  }

  private assertEvidenceLinks(
    state: ReturnType<CrewJournal['state']>,
    current: CrewWorkItemSnapshot,
    request: UpdateCrewWorkItemRequest,
  ): void {
    if (request.latestReportId !== undefined) {
      const report = state.reports.find(item => item.id === request.latestReportId)
      if (report?.taskId !== current.taskId) {
        throw new CrewError('Crew report does not belong to this work item', 'CREW_EVIDENCE_NOT_FOUND')
      }
    }
    if (request.latestVerificationId !== undefined) {
      const verification = state.verifications.find(item => item.id === request.latestVerificationId)
      if (verification?.taskId !== current.taskId) {
        throw new CrewError('Crew verification does not belong to this work item', 'CREW_EVIDENCE_NOT_FOUND')
      }
    }
    if (request.latestReviewId !== undefined) {
      const review = state.reviews.find(item => item.id === request.latestReviewId)
      if (review?.taskId !== current.taskId) {
        throw new CrewError('Crew review does not belong to this work item', 'CREW_EVIDENCE_NOT_FOUND')
      }
    }
    if (request.acceptedIntegrationId !== undefined) {
      const integration = state.integrations.find(item => item.id === request.acceptedIntegrationId)
      if (integration?.status !== 'passed' || !integration.inputs.some(input => input.taskId === current.taskId)) {
        throw new CrewError('passed Crew integration does not contain this work item', 'CREW_EVIDENCE_NOT_FOUND')
      }
    }
  }
}

function sameScopes(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function workerName(
  role: CrewWorkerRole,
  moduleKey: string,
  attempt: number,
  childId: SessionId,
): string {
  return `${role}-${moduleKey.slice(0, 32)}-${attempt}-${childId.slice(0, 8)}`
}

function developerPrompt(workItem: CrewWorkItemSnapshot, sharedDirectories: readonly string[]): string {
  return [
    `Implement Crew work item ${workItem.taskId} for module ${workItem.moduleKey}.`,
    `Read the frozen specification at ${workItem.specPath} revision ${workItem.specRevision}.`,
    `Readable paths: ${workItem.readScopes.join(', ') || '(none)'}.`,
    `Writable paths: ${workItem.writeScopes.join(', ')}.`,
    `Shared documentation and test directories: ${sharedDirectories.join(', ') || '(none)'}. Coordinate edits to shared files and preserve other workers' changes.`,
    `Required artifacts: ${workItem.requiredArtifacts.join(', ') || '(none)'}.`,
    `Declared tests: ${workItem.testCommands.map(command => command.id).join(', ') || '(none)'}.`,
    'Use only the Crew tools made available to you. Record exactly one crew_report with ready or blocked before finishing. A ready report is a handoff request; the host independently decides whether the work advances.',
  ].join('\n')
}

function reviewerPrompt(
  workItem: CrewWorkItemSnapshot,
  verification: CrewVerificationSnapshot,
): string {
  return [
    `Review Crew work item ${workItem.taskId} for module ${workItem.moduleKey}.`,
    `The frozen specification is ${workItem.specPath} revision ${workItem.specRevision}.`,
    `Review host verification ${verification.id}; observed paths: ${verification.changedPaths.join(', ') || '(none)'}.`,
    `Host tests: ${verification.commands.map(command => `${command.commandId}=${String(command.exitCode)}`).join(', ') || '(none)'}.`,
    'Read the complete project to check requirements, implementation and tests. Run declared tests when useful. Do not edit implementation files. Record exactly one crew_report tied to the supplied verification with passed and no issues, or rejected with concrete path, optional line, problem, and expected result.',
  ].join('\n')
}

function integratorPrompt(
  integration: CrewIntegrationSnapshot,
  workItems: readonly CrewWorkItemSnapshot[],
): string {
  return [
    `Inspect Crew integration ${integration.id}.`,
    `Frozen work items: ${workItems.map(item => `${item.taskId}@${item.revision}`).join(', ')}.`,
    'Read and write access covers the complete project; protected metadata and credentials remain unavailable.',
    `Combined host tests: ${integration.testCommands.map(command => command.id).join(', ') || '(none)'}.`,
    'Connect shared interfaces and make necessary integration edits. Preserve unrelated work. Run combined tests and include every path changed since integration began in crew_report. Report passed with no issues, or rejected with concrete issues for manager coordination. The host reruns combined tests after your report.',
  ].join('\n')
}

function changedSince(
  baseline: CrewCheckoutSnapshot,
  current: CrewCheckoutSnapshot,
): string[] {
  const paths = new Set([...Object.keys(baseline.pathDigests), ...Object.keys(current.pathDigests)])
  return [...paths]
    .filter(path => baseline.pathDigests[path] !== current.pathDigests[path])
    .sort()
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const values = new Set(left)
  return values.size === left.length && right.every(value => values.has(value))
}

/** Other workers may change disjoint modules while this work item's evidence remains valid. */
function sameWorkCheckout(
  expected: CrewCheckoutSnapshot,
  current: CrewCheckoutSnapshot,
  workItem: CrewWorkItemSnapshot,
  additionalPaths: readonly string[] = [],
): boolean {
  const scopes = [...workItem.readScopes, ...workItem.writeScopes, workItem.specPath, ...additionalPaths]
  return expected.head === current.head
    && expected.branch === current.branch
    && !changedSince(expected, current).some(path => scopes.some(scope => pathInCrewScope(path, scope)))
}

function samePathDigests(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b))
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries)
}

function sameCheckoutWorld(left: CrewCheckoutSnapshot, right: CrewCheckoutSnapshot): boolean {
  return left.head === right.head
    && left.branch === right.branch
    && left.statusDigest === right.statusDigest
    && sameStringSet(left.changedPaths, right.changedPaths)
    && samePathDigests(left.pathDigests, right.pathDigests)
}

function agentOptions(snapshot: CrewAgentOptionsSnapshot): AgentOptions {
  return {
    ...(snapshot.provider === undefined ? {} : { provider: snapshot.provider }),
    ...(snapshot.model === undefined ? {} : { model: snapshot.model }),
    ...(snapshot.reasoningEffort === undefined ? {} : { reasoningEffort: snapshot.reasoningEffort }),
  }
}

function workerSource(
  teamId: CrewWorkerMessageSource['teamId'],
  workItem: CrewWorkItemSnapshot,
  role: 'developer' | 'reviewer',
): CrewWorkerMessageSource {
  return {
    kind: 'crew-worker',
    role,
    teamId,
    taskId: workItem.taskId,
    workItemRevision: workItem.revision,
  }
}

function integrationSource(
  teamId: CrewWorkerMessageSource['teamId'],
  integration: CrewIntegrationSnapshot,
): CrewWorkerMessageSource {
  return {
    kind: 'crew-worker',
    role: 'integrator',
    teamId,
    integrationId: integration.id,
    integrationRevision: integration.revision,
  }
}

function workRecoverySource(
  teamId: CrewWorkerMessageSource['teamId'],
  binding: Extract<RecoveryBinding, { role: 'developer' | 'reviewer' }>,
): CrewWorkerMessageSource {
  return {
    kind: 'crew-worker',
    role: binding.role,
    teamId,
    taskId: binding.taskId,
    workItemRevision: binding.revision,
  }
}

function integrationRecoverySource(
  teamId: CrewWorkerMessageSource['teamId'],
  binding: Extract<RecoveryBinding, { role: 'integrator' }>,
): CrewWorkerMessageSource {
  return {
    kind: 'crew-worker',
    role: 'integrator',
    teamId,
    integrationId: binding.integrationId,
    integrationRevision: binding.revision,
  }
}

function recoveredTerminal(
  events: readonly SessionEvent[],
  childId: SessionId,
  binding: RecoveryBinding,
  provider: string,
): SubagentRunEndInfo | undefined {
  let candidate: { promptIndex: number; endIndex: number } | undefined
  for (let promptIndex = 0; promptIndex < events.length; promptIndex += 1) {
    const event = events[promptIndex]
    if (event?.type !== 'user/message' || !sourceMatchesBinding(event.data.source, binding)) continue
    const offset = events.slice(promptIndex + 1).findIndex(item => item.type === 'turn/end')
    if (offset < 0) continue
    candidate = { promptIndex, endIndex: promptIndex + 1 + offset }
  }
  if (candidate === undefined) return undefined
  const end = events[candidate.endIndex]
  if (end?.type !== 'turn/end') return undefined
  const output = finalAssistantOutput(events.slice(candidate.promptIndex, candidate.endIndex + 1))
  return {
    runId: SubagentRunId(`crew-recovery-${childId}-${end.seq}`),
    provider,
    id: childId,
    local: true,
    stopReason: turnStopReason(end.data.reason.kind),
    ...(output === undefined ? {} : { lastAssistantMessage: output }),
  }
}

function sourceMatchesBinding(source: MessageSource, binding: RecoveryBinding): boolean {
  if (source.kind !== 'crew-worker' || source.role !== binding.role) return false
  return binding.role === 'integrator'
    ? source.role === 'integrator'
      && source.integrationId === binding.integrationId
      && source.integrationRevision === binding.revision
    : source.role !== 'integrator'
      && source.taskId === binding.taskId
      && source.workItemRevision === binding.revision
}

function turnStopReason(kind: string): SubagentStopReason {
  switch (kind) {
    case 'completed': return 'completed'
    case 'max-tokens': return 'max-tokens'
    case 'aborted': return 'aborted'
    case 'blocked': return 'refusal'
    default: return 'error'
  }
}

function renderNotificationContent(
  events: readonly SessionEvent[],
  sourceSeqs: readonly SessionEvent['seq'][],
): string {
  const lines = sourceSeqs.map((seq) => {
    const event = events[seq]
    if (event?.type === 'crew/work-item') {
      const work = event.data.workItem
      return `- ${work.moduleKey} (${work.taskId}) is ${work.stage}: ${work.reason ?? 'no reason recorded'}`
    }
    if (event?.type === 'crew/integration') {
      const integration = event.data.integration
      return `- Integration ${integration.id} is ${integration.status}: ${integration.summary}`
    }
    return `- Crew event ${seq} requires attention.`
  })
  return ['Crew recorded workflow changes that require manager action:', ...lines].join('\n')
}

function messageObserved(root: Agent, id: ReturnType<typeof MessageId>): boolean {
  if (root.inbox.nextTurn.some(message => message.id === id)
    || root.inbox.nextStep.some(message => message.id === id)) return true
  return root.session.snapshotEvents().some((event) => {
    if (event.type === 'user/message') return event.data.id === id
    return event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.id === id)
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default CrewService
