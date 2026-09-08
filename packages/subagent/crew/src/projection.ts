/** Host-only Crew state projected incrementally from manager Session events. */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionEvent, SessionEventMap, SessionId } from '@deepseek-ai/dsh-session'
import { SessionSeq as toSessionSeq } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { TeamId, TeamTaskId } from '@deepseek-ai/dsh-agent-team'
import { canTransitionCrewStage } from './transition.ts'
import {
  CrewCommitId,
  CrewIntegrationId,
  CrewNotificationId,
  CrewReportId,
  CrewReviewId,
  CrewVerificationId,
} from './types.ts'
import type {
  CrewCommitSnapshot,
  CrewConfigurationSnapshot,
  CrewIntegrationSnapshot,
  CrewNotificationSnapshot,
  CrewReportSnapshot,
  CrewReviewSnapshot,
  CrewVerificationSnapshot,
  CrewWorkItemSnapshot,
  CrewProjectionState,
  CrewProjectionView,
} from './types.ts'

const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const positiveSafeInteger = nonNegativeSafeInteger.min(1)
const timerDuration = positiveSafeInteger.max(MAX_TIMER_DELAY_MS)
const nonEmpty = z.string().min(1)
const sessionIdSchema = nonEmpty.transform(value => brandString<SessionId>(value))
const teamIdSchema = nonEmpty.transform(value => TeamId(value))
const taskIdSchema = nonEmpty.transform(value => TeamTaskId(value))
const reportIdSchema = nonEmpty.transform(value => CrewReportId(value))
const verificationIdSchema = nonEmpty.transform(value => CrewVerificationId(value))
const reviewIdSchema = nonEmpty.transform(value => CrewReviewId(value))
const integrationIdSchema = nonEmpty.transform(value => CrewIntegrationId(value))
const notificationIdSchema = nonEmpty.transform(value => CrewNotificationId(value))
const commitIdSchema = nonEmpty.transform(value => CrewCommitId(value))
const messageIdSchema = nonEmpty.transform(value => brandString<MessageId>(value))
const sessionSeqSchema = nonNegativeSafeInteger.transform(value => toSessionSeq(value))

const toolRestrictionSchema = z.object({
  allow: z.array(nonEmpty).optional(),
  deny: z.array(nonEmpty).optional(),
}).strict().refine(value => value.allow !== undefined || value.deny !== undefined)

const agentOptionsSchema = z.object({
  provider: nonEmpty.optional(),
  model: nonEmpty.optional(),
  reasoningEffort: nonEmpty.optional(),
}).strict()

const rolePresetSchema = z.object({
  role: z.enum(['developer', 'reviewer', 'integrator']),
  persona: nonEmpty,
  toolFilter: toolRestrictionSchema,
  agentOptions: agentOptionsSchema,
  maxDepth: nonNegativeSafeInteger,
}).strict()

const configurationSchema = z.object({
  repositoryRoot: nonEmpty,
  nativeProvider: nonEmpty,
  maxConcurrentWorkers: positiveSafeInteger,
  notificationBatchWindowMs: timerDuration,
  workerTurnTimeoutMs: timerDuration,
  maxAutomaticRepairs: nonNegativeSafeInteger,
  maxReviewRounds: positiveSafeInteger,
  allowedTestPrograms: z.array(nonEmpty),
  sharedDirectories: z.array(nonEmpty).default(['docs', 'test', 'tests']),
  execution: z.object({
    maxInputBytes: positiveSafeInteger.optional(),
    maxInputEntries: positiveSafeInteger.optional(),
    maxOutputBytes: positiveSafeInteger,
    processGraceMs: timerDuration,
    pollIntervalMs: timerDuration.optional(),
    gitTimeoutMs: timerDuration,
  }).strict(),
  commitPolicy: z.object({
    maxMessageLength: positiveSafeInteger,
    requireNamedBranch: z.boolean(),
  }).strict(),
  roles: z.object({
    developer: rolePresetSchema,
    reviewer: rolePresetSchema,
    integrator: rolePresetSchema,
  }).strict(),
}).strict() as unknown as z.ZodType<CrewConfigurationSnapshot>

const commandSpecSchema = z.object({
  id: nonEmpty,
  argv: z.array(nonEmpty).min(1),
  cwd: nonEmpty,
  timeoutMs: timerDuration,
}).strict()

const checkoutSchema = z.object({
  head: nonEmpty.nullable(),
  branch: nonEmpty.optional(),
  statusDigest: nonEmpty,
  changedPaths: z.array(nonEmpty),
  stagedPaths: z.array(nonEmpty),
  pathDigests: z.record(nonEmpty, nonEmpty),
}).strict().refine(value => value.head !== null || (value.branch === undefined && value.stagedPaths.length === 0))

const workItemSchema = z.object({
  taskId: taskIdSchema,
  revision: positiveSafeInteger,
  moduleKey: nonEmpty,
  specPath: nonEmpty,
  specRevision: positiveSafeInteger,
  readScopes: z.array(nonEmpty),
  writeScopes: z.array(nonEmpty),
  requiredArtifacts: z.array(nonEmpty),
  testCommands: z.array(commandSpecSchema),
  baseline: checkoutSchema,
  stage: z.enum([
    'planned', 'queued', 'running', 'verifying', 'reviewing', 'revision_required',
    'integration_ready', 'accepted', 'paused', 'failed', 'cancelled',
  ]),
  reason: z.string().optional(),
  developerName: nonEmpty.optional(),
  developerSessionId: sessionIdSchema.optional(),
  reviewerName: nonEmpty.optional(),
  reviewerSessionId: sessionIdSchema.optional(),
  workerSessionIds: z.array(sessionIdSchema),
  attempt: positiveSafeInteger,
  automaticRepairCount: nonNegativeSafeInteger,
  reviewRound: nonNegativeSafeInteger,
  latestReportId: reportIdSchema.optional(),
  latestVerificationId: verificationIdSchema.optional(),
  latestReviewId: reviewIdSchema.optional(),
  acceptedIntegrationId: integrationIdSchema.optional(),
}).strict() as z.ZodType<CrewWorkItemSnapshot>

const issueSchema = z.object({
  path: nonEmpty,
  line: positiveSafeInteger.optional(),
  message: nonEmpty,
  expected: nonEmpty,
}).strict()

const reportSchema = z.object({
  id: reportIdSchema,
  taskId: taskIdSchema.optional(),
  integrationId: integrationIdSchema.optional(),
  workItemRevision: positiveSafeInteger.optional(),
  integrationRevision: positiveSafeInteger.optional(),
  role: z.enum(['developer', 'reviewer', 'integrator']),
  workerSessionId: sessionIdSchema,
  specRevision: positiveSafeInteger.optional(),
  verificationId: verificationIdSchema.optional(),
  verdict: z.enum(['ready', 'blocked', 'passed', 'rejected']),
  summary: nonEmpty,
  changedPaths: z.array(nonEmpty),
  issues: z.array(issueSchema),
}).strict() as z.ZodType<CrewReportSnapshot>

const commandResultSchema = z.object({
  commandId: nonEmpty,
  argv: z.array(nonEmpty).min(1),
  cwd: nonEmpty,
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  timedOut: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
  stdoutTruncated: z.boolean(),
  stderrTruncated: z.boolean(),
}).strict()

const verificationSchema = z.object({
  id: verificationIdSchema,
  taskId: taskIdSchema,
  reportId: reportIdSchema,
  workerSessionId: sessionIdSchema,
  specRevision: positiveSafeInteger,
  startedAt: nonNegativeSafeInteger,
  finishedAt: nonNegativeSafeInteger,
  workerStopReason: nonEmpty,
  checkout: checkoutSchema,
  changedPaths: z.array(nonEmpty),
  outOfScopePaths: z.array(nonEmpty),
  missingArtifacts: z.array(nonEmpty),
  commands: z.array(commandResultSchema),
  verdict: z.enum(['passed', 'failed']),
  summary: nonEmpty,
}).strict() as z.ZodType<CrewVerificationSnapshot>

const reviewSchema = z.object({
  id: reviewIdSchema,
  taskId: taskIdSchema,
  reportId: reportIdSchema,
  reviewerSessionId: sessionIdSchema,
  specRevision: positiveSafeInteger,
  verificationId: verificationIdSchema,
  round: positiveSafeInteger,
  verdict: z.enum(['passed', 'rejected']),
  issues: z.array(issueSchema),
  summary: nonEmpty,
  stopReason: nonEmpty,
}).strict() as z.ZodType<CrewReviewSnapshot>

const integrationInputSchema = z.object({
  taskId: taskIdSchema,
  workItemRevision: positiveSafeInteger,
  verificationId: verificationIdSchema,
  reviewId: reviewIdSchema,
}).strict()

const integrationSchema = z.object({
  id: integrationIdSchema,
  revision: positiveSafeInteger,
  status: z.enum(['running', 'passed', 'failed', 'cancelled']),
  integratorSessionId: sessionIdSchema,
  inputCheckout: checkoutSchema,
  inputs: z.array(integrationInputSchema).min(1),
  testCommands: z.array(commandSpecSchema),
  commands: z.array(commandResultSchema),
  issues: z.array(issueSchema),
  summary: z.string(),
  stopReason: nonEmpty.optional(),
  checkout: checkoutSchema.optional(),
  approvedPaths: z.array(nonEmpty).optional(),
}).strict() as z.ZodType<CrewIntegrationSnapshot>

const notificationSchema = z.object({
  id: notificationIdSchema,
  revision: positiveSafeInteger,
  sourceEventSeqs: z.array(sessionSeqSchema).min(1),
  content: nonEmpty,
  status: z.enum(['queued', 'delivered']),
  deliveryMessageId: messageIdSchema,
}).strict() as z.ZodType<CrewNotificationSnapshot>

const commitSchema = z.object({
  id: commitIdSchema,
  integrationId: integrationIdSchema,
  approvalCallId: nonEmpty,
  stagedPaths: z.array(nonEmpty),
  message: nonEmpty,
  status: z.enum(['committed', 'rejected']),
  commitHash: nonEmpty.optional(),
  reason: nonEmpty.optional(),
}).strict() as z.ZodType<CrewCommitSnapshot>

const selectorSchema = z.object({ version: nonNegativeSafeInteger, teamId: teamIdSchema }).loose()
const configurationEventSchema = z.object({ version: z.literal(1), teamId: teamIdSchema, configuration: configurationSchema }).strict() as z.ZodType<SessionEventMap['crew/configuration']>
const workItemEventSchema = z.object({ version: z.literal(1), teamId: teamIdSchema, workItem: workItemSchema }).strict() as z.ZodType<SessionEventMap['crew/work-item']>
const reportEventSchema = z.object({ version: z.literal(1), teamId: teamIdSchema, report: reportSchema }).strict() as z.ZodType<SessionEventMap['crew/report']>
const verificationEventSchema = z.object({ version: z.literal(1), teamId: teamIdSchema, verification: verificationSchema }).strict() as z.ZodType<SessionEventMap['crew/verification']>
const reviewEventSchema = z.object({ version: z.literal(1), teamId: teamIdSchema, review: reviewSchema }).strict() as z.ZodType<SessionEventMap['crew/review']>
const integrationEventSchema = z.object({ version: z.literal(1), teamId: teamIdSchema, integration: integrationSchema }).strict() as z.ZodType<SessionEventMap['crew/integration']>
const notificationEventSchema = z.object({ version: z.literal(1), teamId: teamIdSchema, notification: notificationSchema }).strict() as z.ZodType<SessionEventMap['crew/notification']>
const commitEventSchema = z.object({ version: z.literal(1), teamId: teamIdSchema, commit: commitSchema }).strict() as z.ZodType<SessionEventMap['crew/commit']>

const stateSchema = z.object({
  id: teamIdSchema,
  configuration: configurationSchema.optional(),
  workItems: z.array(workItemSchema),
  reports: z.array(reportSchema),
  verifications: z.array(verificationSchema),
  reviews: z.array(reviewSchema),
  integrations: z.array(integrationSchema),
  notifications: z.array(notificationSchema),
  commits: z.array(commitSchema),
  failure: z.string().optional(),
}).strict() as z.ZodType<CrewProjectionState>

const projectionViewSchema = z.object({
  configured: z.boolean(),
  repositoryRoot: nonEmpty.optional(),
  workItems: z.array(workItemSchema),
  reports: z.array(reportSchema),
  verifications: z.array(verificationSchema),
  reviews: z.array(reviewSchema),
  integrations: z.array(integrationSchema),
  notifications: z.array(notificationSchema),
  commits: z.array(commitSchema),
  failure: z.string().optional(),
}).strict() as z.ZodType<CrewProjectionView>

/** Crew-owned Session event names. */
export type CrewEventType =
  | 'crew/configuration'
  | 'crew/work-item'
  | 'crew/report'
  | 'crew/verification'
  | 'crew/review'
  | 'crew/integration'
  | 'crew/notification'
  | 'crew/commit'

type CrewSessionEvent = SessionEvent<CrewEventType>

/**
 * Construct empty state for one root Session identity.
 * @param rootId - Durable manager Session identity.
 * @returns Empty Crew projection state keyed to that manager.
 */
export function emptyCrewState(rootId: SessionId): CrewProjectionState {
  return {
    id: TeamId(rootId),
    workItems: [],
    reports: [],
    verifications: [],
    reviews: [],
    integrations: [],
    notifications: [],
    commits: [],
  }
}

/**
 * Test whether an event belongs to the Crew domain.
 * @param event - Session event to discriminate.
 * @returns Whether the event is one of the Crew event types.
 */
export function isCrewEvent(event: SessionEvent): event is CrewSessionEvent {
  return event.type === 'crew/configuration'
    || event.type === 'crew/work-item'
    || event.type === 'crew/report'
    || event.type === 'crew/verification'
    || event.type === 'crew/review'
    || event.type === 'crew/integration'
    || event.type === 'crew/notification'
    || event.type === 'crew/commit'
}

function parse<T>(type: CrewEventType, schema: z.ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value)
  } catch (error: unknown) {
    throw new Error(`persisted Crew ${type} payload is invalid`, { cause: error })
  }
}

function parsedEvent(event: CrewSessionEvent): CrewSessionEvent {
  switch (event.type) {
    case 'crew/configuration': return { ...event, data: parse(event.type, configurationEventSchema, event.data) }
    case 'crew/work-item': return { ...event, data: parse(event.type, workItemEventSchema, event.data) }
    case 'crew/report': return { ...event, data: parse(event.type, reportEventSchema, event.data) }
    case 'crew/verification': return { ...event, data: parse(event.type, verificationEventSchema, event.data) }
    case 'crew/review': return { ...event, data: parse(event.type, reviewEventSchema, event.data) }
    case 'crew/integration': return { ...event, data: parse(event.type, integrationEventSchema, event.data) }
    case 'crew/notification': return { ...event, data: parse(event.type, notificationEventSchema, event.data) }
    case 'crew/commit': return { ...event, data: parse(event.type, commitEventSchema, event.data) }
    default: return event
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function applyCurrent(state: CrewProjectionState, event: CrewSessionEvent): void {
  switch (event.type) {
    case 'crew/configuration': {
      if (state.configuration !== undefined) throw new Error('Crew configuration was recorded twice')
      const configuration = event.data.configuration
      if (configuration.roles.developer.role !== 'developer'
        || configuration.roles.reviewer.role !== 'reviewer'
        || configuration.roles.integrator.role !== 'integrator') {
        throw new Error('Crew role preset keys do not match their roles')
      }
      state.configuration = configuration
      return
    }
    case 'crew/work-item': {
      if (state.configuration === undefined) throw new Error('Crew work item was recorded before configuration')
      const next = event.data.workItem
      const index = state.workItems.findIndex(item => item.taskId === next.taskId)
      const prior = state.workItems[index]
      if (prior === undefined) {
        if (next.revision !== 1 || next.stage !== 'planned') {
          throw new Error(`Crew work item "${next.taskId}" must begin planned at revision 1`)
        }
      } else {
        if (next.revision !== prior.revision + 1) throw new Error(`Crew work item "${next.taskId}" revision is not contiguous`)
        if (!canTransitionCrewStage(prior.stage, next.stage)) {
          throw new Error(`Crew work item "${next.taskId}" has invalid ${prior.stage} -> ${next.stage} transition`)
        }
        const immutablePrior = {
          taskId: prior.taskId,
          moduleKey: prior.moduleKey,
          specPath: prior.specPath,
          readScopes: prior.readScopes,
          writeScopes: prior.writeScopes,
          requiredArtifacts: prior.requiredArtifacts,
          testCommands: prior.testCommands,
          baseline: prior.baseline,
        }
        const immutableNext = {
          taskId: next.taskId,
          moduleKey: next.moduleKey,
          specPath: next.specPath,
          readScopes: next.readScopes,
          writeScopes: next.writeScopes,
          requiredArtifacts: next.requiredArtifacts,
          testCommands: next.testCommands,
          baseline: next.baseline,
        }
        if (!sameJson(immutablePrior, immutableNext)) throw new Error(`Crew work item "${next.taskId}" changed immutable fields`)
        if (prior.workerSessionIds.some((id, offset) => next.workerSessionIds[offset] !== id)) {
          throw new Error(`Crew work item "${next.taskId}" rewrote worker Session history`)
        }
      }
      if (next.latestReportId !== undefined && !state.reports.some(report => report.id === next.latestReportId)) {
        throw new Error(`Crew work item "${next.taskId}" references a missing report`)
      }
      if (next.latestVerificationId !== undefined && !state.verifications.some(item => item.id === next.latestVerificationId)) {
        throw new Error(`Crew work item "${next.taskId}" references a missing verification`)
      }
      if (next.latestReviewId !== undefined && !state.reviews.some(item => item.id === next.latestReviewId)) {
        throw new Error(`Crew work item "${next.taskId}" references a missing review`)
      }
      if (next.acceptedIntegrationId !== undefined) {
        const integration = state.integrations.find(item => item.id === next.acceptedIntegrationId)
        if (integration?.status !== 'passed' || !integration.inputs.some(input => input.taskId === next.taskId)) {
          throw new Error(`Crew work item "${next.taskId}" references a non-passing integration`)
        }
      }
      if (index < 0) state.workItems.push(next)
      else state.workItems[index] = next
      return
    }
    case 'crew/report': {
      const report = event.data.report
      if (state.reports.some(item => item.id === report.id)) throw new Error(`Crew report "${report.id}" was recorded twice`)
      if (report.role === 'integrator') {
        if (report.integrationId === undefined || report.integrationRevision === undefined
          || report.taskId !== undefined || report.workItemRevision !== undefined) {
          throw new Error('integrator report must name only an integration revision')
        }
        if (!state.integrations.some(item => item.id === report.integrationId && item.revision === report.integrationRevision)) {
          throw new Error(`Crew report "${report.id}" references a missing integration revision`)
        }
      } else {
        if (report.taskId === undefined || report.workItemRevision === undefined
          || report.integrationId !== undefined || report.integrationRevision !== undefined) {
          throw new Error(`${report.role} report must name only a work-item revision`)
        }
        if (!state.workItems.some(item => item.taskId === report.taskId && item.revision === report.workItemRevision)) {
          throw new Error(`Crew report "${report.id}" references a missing work-item revision`)
        }
      }
      state.reports.push(report)
      return
    }
    case 'crew/verification': {
      const verification = event.data.verification
      if (state.verifications.some(item => item.id === verification.id)) throw new Error(`Crew verification "${verification.id}" was recorded twice`)
      const report = state.reports.find(item => item.id === verification.reportId)
      if (report?.taskId !== verification.taskId || report.workerSessionId !== verification.workerSessionId) {
        throw new Error(`Crew verification "${verification.id}" does not match its report`)
      }
      if (verification.finishedAt < verification.startedAt) throw new Error(`Crew verification "${verification.id}" finished before it started`)
      state.verifications.push(verification)
      return
    }
    case 'crew/review': {
      const review = event.data.review
      if (state.reviews.some(item => item.id === review.id)) throw new Error(`Crew review "${review.id}" was recorded twice`)
      const report = state.reports.find(item => item.id === review.reportId)
      const verification = state.verifications.find(item => item.id === review.verificationId)
      if (report?.taskId !== review.taskId || report.workerSessionId !== review.reviewerSessionId || report.role !== 'reviewer') {
        throw new Error(`Crew review "${review.id}" does not match its report`)
      }
      if (verification?.taskId !== review.taskId || verification.verdict !== 'passed') {
        throw new Error(`Crew review "${review.id}" does not reference a passing verification`)
      }
      state.reviews.push(review)
      return
    }
    case 'crew/integration': {
      const next = event.data.integration
      const index = state.integrations.findIndex(item => item.id === next.id)
      const prior = state.integrations[index]
      if (prior === undefined) {
        if (next.revision !== 1 || next.status !== 'running') throw new Error(`Crew integration "${next.id}" must begin running at revision 1`)
        for (const input of next.inputs) {
          const workItem = state.workItems.find(item => item.taskId === input.taskId)
          const verification = state.verifications.find(item => item.id === input.verificationId)
          const review = state.reviews.find(item => item.id === input.reviewId)
          if (workItem?.revision !== input.workItemRevision || workItem.stage !== 'integration_ready') {
            throw new Error(`Crew integration "${next.id}" has a stale work-item input`)
          }
          if (verification?.taskId !== input.taskId || verification.verdict !== 'passed') {
            throw new Error(`Crew integration "${next.id}" has a non-passing verification input`)
          }
          if (review?.taskId !== input.taskId || review.verdict !== 'passed') {
            throw new Error(`Crew integration "${next.id}" has a non-passing review input`)
          }
        }
      } else {
        if (next.revision !== prior.revision + 1) throw new Error(`Crew integration "${next.id}" revision is not contiguous`)
        if (prior.status !== 'running' || next.status === 'running') throw new Error(`Crew integration "${next.id}" has an invalid ${prior.status} -> ${next.status} transition`)
        if (next.integratorSessionId !== prior.integratorSessionId
          || !sameJson(next.inputCheckout, prior.inputCheckout)
          || !sameJson(next.inputs, prior.inputs)
          || !sameJson(next.testCommands, prior.testCommands)) {
          throw new Error(`Crew integration "${next.id}" changed immutable inputs`)
        }
        if (next.status === 'passed' && (next.checkout === undefined || next.approvedPaths === undefined)) {
          throw new Error(`Crew integration "${next.id}" passed without checkout evidence`)
        }
      }
      if (index < 0) state.integrations.push(next)
      else state.integrations[index] = next
      return
    }
    case 'crew/notification': {
      const next = event.data.notification
      const index = state.notifications.findIndex(item => item.id === next.id)
      const prior = state.notifications[index]
      if (prior === undefined) {
        if (next.revision !== 1 || next.status !== 'queued') throw new Error(`Crew notification "${next.id}" must begin queued at revision 1`)
        if (new Set(next.sourceEventSeqs).size !== next.sourceEventSeqs.length) {
          throw new Error(`Crew notification "${next.id}" repeats a source event`)
        }
      } else {
        if (next.revision !== prior.revision + 1 || prior.status !== 'queued' || next.status !== 'delivered') {
          throw new Error(`Crew notification "${next.id}" has an invalid delivery transition`)
        }
        const changedDelivery = next.content !== prior.content
          || next.deliveryMessageId !== prior.deliveryMessageId
          || !sameJson(next.sourceEventSeqs, prior.sourceEventSeqs)
        if (changedDelivery) {
          throw new Error(`Crew notification "${next.id}" changed immutable delivery fields`)
        }
      }
      if (index < 0) state.notifications.push(next)
      else state.notifications[index] = next
      return
    }
    case 'crew/commit': {
      const commit = event.data.commit
      if (state.commits.some(item => item.id === commit.id)) throw new Error(`Crew commit "${commit.id}" was recorded twice`)
      const integration = state.integrations.find(item => item.id === commit.integrationId)
      if (commit.status === 'committed' && integration?.status !== 'passed') {
        throw new Error(`Crew commit "${commit.id}" does not reference a passing integration`)
      }
      if ((commit.status === 'committed') !== (commit.commitHash !== undefined)) {
        throw new Error(`Crew commit "${commit.id}" has inconsistent commit hash state`)
      }
      state.commits.push(commit)
    }
  }
}

function applyEvent(state: CrewProjectionState, event: SessionEvent): CrewProjectionState {
  if (state.failure !== undefined || !isCrewEvent(event)) return state
  try {
    const selector = parse(event.type, selectorSchema, event.data)
    if (selector.teamId !== state.id) return state
    const next = structuredClone(state)
    if (selector.version !== 1) throw new Error(`unsupported Crew event version ${String(selector.version)}`)
    applyCurrent(next, parsedEvent(event))
    return next
  } catch (error: unknown) {
    return {
      ...state,
      failure: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Native Crew projection selected by the projected root Session identity. */
export const crewProjectionDefinition = {
  key: 'crew',
  stateVersion: 1,
  stateSchema,
  init: header => emptyCrewState(header.id),
  apply: applyEvent,
  wire: {
    viewSchema: projectionViewSchema,
    view: state => ({
      configured: state.configuration !== undefined,
      ...state.configuration === undefined ? {} : { repositoryRoot: state.configuration.repositoryRoot },
      workItems: state.workItems,
      reports: state.reports,
      verifications: state.verifications,
      reviews: state.reviews,
      integrations: state.integrations,
      notifications: state.notifications,
      commits: state.commits,
      ...state.failure === undefined ? {} : { failure: state.failure },
    }),
  },
} satisfies ProjectionDefinition<'crew', CrewProjectionState>
