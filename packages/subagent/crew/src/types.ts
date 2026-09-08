/** Public Crew identities, durable records, views, and service requests. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { MessageId, ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import type { SubagentStopReason } from '@deepseek-ai/dsh-subagent/client'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools/types'
import type { TeamId, TeamTaskId } from '@deepseek-ai/dsh-agent-team/client'

/** Stable identity of one worker report. */
export type CrewReportId = Branded<'CrewReportId'>

/**
 * Brand one validated worker-report identity.
 * @param id - Validated opaque identity text.
 * @returns The branded worker-report identity.
 */
export function CrewReportId(id: string): CrewReportId {
  return id as CrewReportId
}

/** Stable identity of one host verification. */
export type CrewVerificationId = Branded<'CrewVerificationId'>

/**
 * Brand one validated verification identity.
 * @param id - Validated opaque identity text.
 * @returns The branded host-verification identity.
 */
export function CrewVerificationId(id: string): CrewVerificationId {
  return id as CrewVerificationId
}

/** Stable identity of one review result. */
export type CrewReviewId = Branded<'CrewReviewId'>

/**
 * Brand one validated review identity.
 * @param id - Validated opaque identity text.
 * @returns The branded review identity.
 */
export function CrewReviewId(id: string): CrewReviewId {
  return id as CrewReviewId
}

/** Stable identity of one integration run. */
export type CrewIntegrationId = Branded<'CrewIntegrationId'>

/**
 * Brand one validated integration identity.
 * @param id - Validated opaque identity text.
 * @returns The branded integration identity.
 */
export function CrewIntegrationId(id: string): CrewIntegrationId {
  return id as CrewIntegrationId
}

/** Stable identity of one manager notification batch. */
export type CrewNotificationId = Branded<'CrewNotificationId'>

/**
 * Brand one validated notification identity.
 * @param id - Validated opaque identity text.
 * @returns The branded notification-batch identity.
 */
export function CrewNotificationId(id: string): CrewNotificationId {
  return id as CrewNotificationId
}

/** Stable identity of one commit attempt. */
export type CrewCommitId = Branded<'CrewCommitId'>

/**
 * Brand one validated commit-attempt identity.
 * @param id - Validated opaque identity text.
 * @returns The branded commit-attempt identity.
 */
export function CrewCommitId(id: string): CrewCommitId {
  return id as CrewCommitId
}

/** Worker roles owned by the native Crew workflow. */
export type CrewWorkerRole = 'developer' | 'reviewer' | 'integrator'

/** Model route fields that Crew can snapshot and reapply without copying merge-extensible Agent options. */
export interface CrewAgentOptionsSnapshot {
  /** Optional registered LLM provider name. */
  readonly provider?: string
  /** Optional provider model name. */
  readonly model?: string
  /** Optional provider-supported reasoning effort. */
  readonly reasoningEffort?: ReasoningEffortId
}

/** Durable software-workflow stage; presentation derives labels and colors from this value. */
export type CrewStage =
  | 'planned'
  | 'queued'
  | 'running'
  | 'verifying'
  | 'reviewing'
  | 'revision_required'
  | 'integration_ready'
  | 'accepted'
  | 'paused'
  | 'failed'
  | 'cancelled'

/** Snapshot of one role's cold-resumable DSH Agent composition. */
export interface CrewRolePresetSnapshot {
  /** Worker role this composition creates. */
  readonly role: CrewWorkerRole
  /** Durable role-specific system instruction. */
  readonly persona: string
  /** Exact allowlist applied to the worker's registered tools. */
  readonly toolFilter: ToolRestriction
  /** LLM route options reapplied when the worker resumes cold. */
  readonly agentOptions: CrewAgentOptionsSnapshot
  /** Maximum descendant depth available to this worker. */
  readonly maxDepth: number
}

/** Immutable first-phase Crew configuration persisted in the manager Session. */
export interface CrewConfigurationSnapshot {
  /** Absolute repository root authorized for the workflow. */
  readonly repositoryRoot: string
  /** Native continuable-subagent provider used for every Crew worker. */
  readonly nativeProvider: string
  /** Maximum simultaneously active developer workers. */
  readonly maxConcurrentWorkers: number
  /** Time window used to combine terminal worker edges into one manager notification. */
  readonly notificationBatchWindowMs: number
  /** Maximum duration of one worker model turn. */
  readonly workerTurnTimeoutMs: number
  /** Maximum automatic developer repair attempts for one work item. */
  readonly maxAutomaticRepairs: number
  /** Maximum independent review rounds for one work item. */
  readonly maxReviewRounds: number
  /** Executable names accepted in declared test commands. */
  readonly allowedTestPrograms: string[]
  /** Project-relative directories shared by developer file tools. */
  readonly sharedDirectories: readonly string[]
  /** Operator-owned local process and output limits. */
  readonly execution: import('./execution.ts').CrewExecutionLimits
  /** Host-owned limits for an approved local commit. */
  readonly commitPolicy: {
    /** Maximum commit-message length. */
    readonly maxMessageLength: number
    /** Whether committing from detached HEAD is rejected. */
    readonly requireNamedBranch: boolean
  }
  /** Complete cold-resumable composition for every worker role. */
  readonly roles: {
    /** Developer worker composition. */
    readonly developer: CrewRolePresetSnapshot
    /** Reviewer worker composition. */
    readonly reviewer: CrewRolePresetSnapshot
    /** Integrator worker composition. */
    readonly integrator: CrewRolePresetSnapshot
  }
}

/** Frozen project observation used to detect work performed after dispatch. */
export interface CrewCheckoutSnapshot {
  /** Committed Git HEAD, or null for a complete local-file inventory without Git evidence. */
  readonly head: string | null
  readonly branch?: string
  readonly statusDigest: string
  /** Git-changed paths, or every inventoried file in local mode; compare pathDigests for work-item changes. */
  readonly changedPaths: string[]
  readonly stagedPaths: string[]
  readonly pathDigests: Record<string, string>
}

/** One exact, shell-free command declaration. */
export interface CrewCommandSpec {
  readonly id: string
  readonly argv: string[]
  readonly cwd: string
  readonly timeoutMs: number
}

/** Whole durable value for one Team-backed Crew work item. */
export interface CrewWorkItemSnapshot {
  readonly taskId: TeamTaskId
  readonly revision: number
  readonly moduleKey: string
  readonly specPath: string
  readonly specRevision: number
  readonly readScopes: string[]
  readonly writeScopes: string[]
  readonly requiredArtifacts: string[]
  readonly testCommands: CrewCommandSpec[]
  readonly baseline: CrewCheckoutSnapshot
  readonly stage: CrewStage
  readonly reason?: string
  readonly developerName?: string
  readonly developerSessionId?: SessionId
  readonly reviewerName?: string
  readonly reviewerSessionId?: SessionId
  readonly workerSessionIds: SessionId[]
  readonly attempt: number
  readonly automaticRepairCount: number
  readonly reviewRound: number
  readonly latestReportId?: CrewReportId
  readonly latestVerificationId?: CrewVerificationId
  readonly latestReviewId?: CrewReviewId
  readonly acceptedIntegrationId?: CrewIntegrationId
}

/** File/line review issue returned through the structured worker report tool. */
export interface CrewIssue {
  readonly path: string
  readonly line?: number
  readonly message: string
  readonly expected: string
}

/** Structured outcome a Crew-owned DSH worker records before its turn settles. */
export interface CrewReportSnapshot {
  readonly id: CrewReportId
  readonly taskId?: TeamTaskId
  readonly integrationId?: CrewIntegrationId
  readonly workItemRevision?: number
  readonly integrationRevision?: number
  readonly role: CrewWorkerRole
  readonly workerSessionId: SessionId
  readonly specRevision?: number
  readonly verificationId?: CrewVerificationId
  readonly verdict: 'ready' | 'blocked' | 'passed' | 'rejected'
  readonly summary: string
  readonly changedPaths: string[]
  readonly issues: CrewIssue[]
}

/** Bounded output retained for one host-owned verification command. */
export interface CrewCommandResult {
  readonly commandId: string
  readonly argv: string[]
  readonly cwd: string
  readonly exitCode: number | null
  readonly signal: string | null
  readonly timedOut: boolean
  readonly stdout: string
  readonly stderr: string
  readonly stdoutTruncated: boolean
  readonly stderrTruncated: boolean
}

/** Immutable host verification for one developer handoff. */
export interface CrewVerificationSnapshot {
  readonly id: CrewVerificationId
  readonly taskId: TeamTaskId
  readonly reportId: CrewReportId
  readonly workerSessionId: SessionId
  readonly specRevision: number
  readonly startedAt: number
  readonly finishedAt: number
  readonly workerStopReason: SubagentStopReason
  /** Checkout observed after the declared tests; review and integration reject changes to its input scopes. */
  readonly checkout: CrewCheckoutSnapshot
  readonly changedPaths: string[]
  readonly outOfScopePaths: string[]
  readonly missingArtifacts: string[]
  readonly commands: CrewCommandResult[]
  readonly verdict: 'passed' | 'failed'
  readonly summary: string
}

/** Immutable review evidence tied to one exact specification and verification. */
export interface CrewReviewSnapshot {
  readonly id: CrewReviewId
  readonly taskId: TeamTaskId
  readonly reportId: CrewReportId
  readonly reviewerSessionId: SessionId
  readonly specRevision: number
  readonly verificationId: CrewVerificationId
  readonly round: number
  readonly verdict: 'passed' | 'rejected'
  readonly issues: CrewIssue[]
  readonly summary: string
  readonly stopReason: SubagentStopReason
}

/** One work item frozen into an integration input set. */
export interface CrewIntegrationInput {
  readonly taskId: TeamTaskId
  readonly workItemRevision: number
  readonly verificationId: CrewVerificationId
  readonly reviewId: CrewReviewId
}

/** Whole durable integration value; terminal updates increment {@link revision}. */
export interface CrewIntegrationSnapshot {
  readonly id: CrewIntegrationId
  readonly revision: number
  readonly status: 'running' | 'passed' | 'failed' | 'cancelled'
  readonly integratorSessionId: SessionId
  /** Quiescent checkout frozen before the integrator starts. */
  readonly inputCheckout: CrewCheckoutSnapshot
  readonly inputs: CrewIntegrationInput[]
  readonly testCommands: CrewCommandSpec[]
  readonly commands: CrewCommandResult[]
  readonly issues: CrewIssue[]
  readonly summary: string
  readonly stopReason?: SubagentStopReason
  readonly checkout?: CrewCheckoutSnapshot
  readonly approvedPaths?: string[]
}

/** Durable manager-notification batch, including the stable input identity used for retry. */
export interface CrewNotificationSnapshot {
  readonly id: CrewNotificationId
  readonly revision: number
  readonly sourceEventSeqs: SessionSeq[]
  readonly content: string
  readonly status: 'queued' | 'delivered'
  readonly deliveryMessageId: MessageId
}

/** Durable outcome of one host-owned local commit attempt. */
export interface CrewCommitSnapshot {
  readonly id: CrewCommitId
  readonly integrationId: CrewIntegrationId
  readonly approvalCallId: string
  readonly stagedPaths: string[]
  readonly message: string
  readonly status: 'committed' | 'rejected'
  readonly commitHash?: string
  readonly reason?: string
}

/** Browser-safe current Crew projection. */
export interface CrewView {
  readonly configured: boolean
  readonly repositoryRoot?: string
  readonly workItems: CrewWorkItemSnapshot[]
  readonly reports: CrewReportSnapshot[]
  readonly verifications: CrewVerificationSnapshot[]
  readonly reviews: CrewReviewSnapshot[]
  readonly integrations: CrewIntegrationSnapshot[]
  readonly notifications: CrewNotificationSnapshot[]
  readonly commits: CrewCommitSnapshot[]
}

/** Browser-streamed Crew view, including replay failure containment. */
export interface CrewProjectionView extends CrewView {
  readonly failure?: string
}

/** Checkpoint-safe Crew state streamed as the root Session's live projection. */
export interface CrewProjectionState {
  readonly id: TeamId
  configuration?: CrewConfigurationSnapshot
  workItems: CrewWorkItemSnapshot[]
  reports: CrewReportSnapshot[]
  verifications: CrewVerificationSnapshot[]
  reviews: CrewReviewSnapshot[]
  integrations: CrewIntegrationSnapshot[]
  notifications: CrewNotificationSnapshot[]
  commits: CrewCommitSnapshot[]
  failure?: string
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Durable native Crew workflow state. */
    crew: CrewProjectionState
  }
  interface SessionProjectionMap {
    /** Live browser-safe native Crew workflow projection. */
    crew: CrewProjectionView
  }
}

/** Deployment-time native Crew configuration. */
export interface Config {
  /** Project-relative directories shared by developer file tools; defaults to docs, test, and tests. */
  readonly sharedDirectories?: readonly string[]
  /** Local process and output limit overrides, resolved at plugin load. */
  readonly execution?: Partial<import('./execution.ts').CrewExecutionLimits>
  /** Repository root authorized for Crew file, test, checkout, and commit operations. */
  readonly repositoryRoot?: string
  /** Continuable-subagent provider selected for native Crew workers. */
  readonly nativeProvider?: string
  /** Maximum simultaneously active developer workers. */
  readonly maxConcurrentWorkers?: number
  /** Time window used to combine terminal worker edges into one manager notification. */
  readonly notificationBatchWindowMs?: number
  /** Maximum duration of one worker model turn. */
  readonly workerTurnTimeoutMs?: number
  /** Maximum automatic developer repair attempts for one work item. */
  readonly maxAutomaticRepairs?: number
  /** Maximum independent review rounds for one work item. */
  readonly maxReviewRounds?: number
  /** Executable names accepted in declared shell-free test commands. */
  readonly allowedTestPrograms?: string[]
  /** Overrides for host-owned local commit limits. */
  readonly commitPolicy?: Partial<CrewConfigurationSnapshot['commitPolicy']>
  /** Role-specific overrides for worker persona, tools, model route, and depth. */
  readonly roles?: Partial<Record<CrewWorkerRole, Partial<Omit<CrewRolePresetSnapshot, 'role'>>>>
}

/** Initial binding between one existing Team task and Crew workflow metadata. */
export interface CreateCrewWorkItemRequest {
  readonly taskId: TeamTaskId
  readonly moduleKey: string
  readonly specPath: string
  readonly specRevision: number
  readonly readScopes: readonly string[]
  readonly writeScopes: readonly string[]
  readonly requiredArtifacts: readonly string[]
  readonly testCommands: readonly CrewCommandSpec[]
  readonly baseline: CrewCheckoutSnapshot
}

/** Compare-and-set update of one Crew work item. */
export interface UpdateCrewWorkItemRequest {
  readonly taskId: TeamTaskId
  readonly expectedRevision: number
  readonly stage: CrewStage
  readonly reason?: string
  readonly developerName?: string
  readonly developerSessionId?: SessionId
  readonly reviewerName?: string
  readonly reviewerSessionId?: SessionId
  readonly appendWorkerSessionId?: SessionId
  readonly attempt?: number
  readonly automaticRepairCount?: number
  readonly reviewRound?: number
  readonly latestReportId?: CrewReportId
  readonly latestVerificationId?: CrewVerificationId
  readonly latestReviewId?: CrewReviewId
  readonly acceptedIntegrationId?: CrewIntegrationId
}

/** Manager request for one new Team task and native developer worker. */
export interface DispatchCrewWorkRequest {
  readonly moduleKey: string
  readonly subject: string
  readonly description: string
  readonly specPath: string
  readonly specRevision: number
  readonly blockedBy?: readonly TeamTaskId[]
  readonly readScopes: readonly string[]
  readonly writeScopes: readonly string[]
  readonly requiredArtifacts: readonly string[]
  readonly testCommands: readonly CrewCommandSpec[]
  readonly signal: AbortSignal
}

/** Manager request to continue the current developer on the same durable child. */
export interface AppendCrewWorkRequest {
  readonly taskId: TeamTaskId
  readonly expectedRevision: number
  readonly message: string
  readonly signal: AbortSignal
}

/** Manager request to interrupt and park one active work item. */
export interface StopCrewWorkRequest {
  readonly taskId: TeamTaskId
  readonly expectedRevision: number
  readonly reason: string
}

/** Manager request to replace a parked developer with a fresh native child. */
export interface ReassignCrewWorkRequest {
  readonly taskId: TeamTaskId
  readonly expectedRevision: number
  readonly reason: string
  readonly signal: AbortSignal
}

/** Model-boundary structured report; Crew supplies its identity and worker attribution. */
export interface RecordCrewReportRequest {
  readonly verdict: CrewReportSnapshot['verdict']
  readonly summary: string
  readonly changedPaths: readonly string[]
  readonly issues: readonly CrewIssue[]
  readonly verificationId?: CrewVerificationId
}

/** Manager request for one frozen integration set and its exact combined tests. */
export interface IntegrateCrewRequest {
  readonly taskIds?: readonly TeamTaskId[]
  readonly testCommands: readonly CrewCommandSpec[]
  readonly signal: AbortSignal
}

/** Approved host-owned local commit operation. */
export interface CommitCrewRequest {
  readonly integrationId: CrewIntegrationId
  readonly message: string
  readonly approvalCallId: string
  readonly signal: AbortSignal
}

/** Exact durable Crew role binding for one live or cold-resumed native worker. */
export type CrewWorkerBinding =
  | {
    readonly role: 'developer' | 'reviewer'
    readonly rootSessionId: SessionId
    readonly taskId: TeamTaskId
    readonly workItemRevision: number
  }
  | {
    readonly role: 'integrator'
    readonly rootSessionId: SessionId
    readonly integrationId: CrewIntegrationId
    readonly integrationRevision: number
  }

/** Bounded text read returned by the Crew worker filesystem. */
export interface CrewFileRead {
  readonly path: string
  readonly content: string
}

/** One direct child in a Crew-authorized repository directory. */
export interface CrewFileEntry {
  readonly name: string
  readonly type: 'file' | 'directory' | 'other'
}

/** Host-authoritative result of one worker-requested declared test. */
export interface CrewTestRun {
  readonly taskId?: TeamTaskId
  readonly integrationId?: CrewIntegrationId
  readonly result: CrewCommandResult
}

/** Durable source on the exact manager input produced for one Crew notification. */
export interface CrewNotificationMessageSource {
  readonly kind: 'crew-notification'
  readonly notificationId: CrewNotificationId
}

/** Durable provenance on one Crew-owned native worker prompt. */
export type CrewWorkerMessageSource =
  | {
    readonly kind: 'crew-worker'
    readonly role: 'developer' | 'reviewer'
    readonly teamId: TeamId
    readonly taskId: TeamTaskId
    readonly workItemRevision: number
  }
  | {
    readonly kind: 'crew-worker'
    readonly role: 'integrator'
    readonly teamId: TeamId
    readonly integrationId: CrewIntegrationId
    readonly integrationRevision: number
  }

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'crew-memory': {
      readonly kind: 'crew-memory'
      readonly revision: number
    }
    'crew-notification': CrewNotificationMessageSource
    'crew-worker': CrewWorkerMessageSource
  }
}

/** Remote mutation result preserving a stale revision separately from other rejections. */
export type CrewMutationResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'crew-conflict' | 'crew-rejected'
      readonly message: string
    }
  }

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Immutable native Crew configuration stored in the Team Lead Session. */
    'crew/configuration': { version: 1; teamId: TeamId; configuration: CrewConfigurationSnapshot }
    /** Whole Crew work-item value stored on every revision. */
    'crew/work-item': { version: 1; teamId: TeamId; workItem: CrewWorkItemSnapshot }
    /** Immutable structured worker report. */
    'crew/report': { version: 1; teamId: TeamId; report: CrewReportSnapshot }
    /** Immutable host verification. */
    'crew/verification': { version: 1; teamId: TeamId; verification: CrewVerificationSnapshot }
    /** Immutable review result. */
    'crew/review': { version: 1; teamId: TeamId; review: CrewReviewSnapshot }
    /** Whole integration value stored on every revision. */
    'crew/integration': { version: 1; teamId: TeamId; integration: CrewIntegrationSnapshot }
    /** Whole manager-notification value stored on queue and delivery. */
    'crew/notification': { version: 1; teamId: TeamId; notification: CrewNotificationSnapshot }
    /** Immutable local commit attempt. */
    'crew/commit': { version: 1; teamId: TeamId; commit: CrewCommitSnapshot }
  }
}
