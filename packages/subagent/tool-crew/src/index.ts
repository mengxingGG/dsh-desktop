/** Scoped model-facing tools for the DSH-native Crew workflow. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { TeamTaskId } from '@deepseek-ai/dsh-agent-team'
import type { TeamMemberView, TeamWaitResult } from '@deepseek-ai/dsh-agent-team'
import {
  CrewIntegrationId,
  CrewMemoryId,
  CrewVerificationId,
} from '@deepseek-ai/dsh-crew'
import type {
  CrewCommandResult,
  CrewCommitSnapshot,
  CrewIntegrationSnapshot,
  CrewReportSnapshot,
  CrewView,
  CrewWorkItemSnapshot,
  CrewWorkerBinding,
} from '@deepseek-ai/dsh-crew'
import { executeApprovedCrewCommit } from '@deepseek-ai/dsh-crew/internal'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { expectsSettlingEdge, managerActionReady } from './wait-state.ts'
import { installManagerContext } from './manager-context.ts'
import type {
  InferValue,
  PreToolDecision,
  ValueSchemaSpec,
} from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'tool-crew'
/** Services required by the native Crew tool Consumer. */
export const inject = ['agents', 'agentTeams', 'crew', 'tools', 'systemPrompt']

/** Crew role names whose exact model-facing tools are fixed by the delivery profile. */
export type CrewToolRole = 'manager' | 'developer' | 'reviewer' | 'integrator'

/** Profile-owned role tool declarations checked before Crew tools register. */
export interface Config {
  /** Require all four role declarations instead of using the package defaults. */
  readonly requireRolePresets?: boolean
  /** Exact ordered tool names for every supplied role. */
  readonly roleTools?: Partial<Record<CrewToolRole, readonly string[]>>
}

/** Loader schema for role-preset validation. */
export const Config: z<Config> = z.object({
  requireRolePresets: z.boolean().default(false),
  roleTools: z.object({
    manager: z.array(z.string()),
    developer: z.array(z.string()),
    reviewer: z.array(z.string()),
    integrator: z.array(z.string()),
  }),
}) as unknown as z<Config>

// The policy states Crew MECHANICS, which are the same for every manager. When
// a session engages the Crew at all is the selected Agent preset's choice, so
// this text names that condition instead of asserting one: the shipped
// `crew-manager` preset mandates orchestration through its own persona and by
// composing no implementation tools, while an ordinary preset keeps its tools
// and the discretion below.
const MANAGER_POLICY = 'Act as the manager of a DSH-native software Crew when your Agent preset mandates Crew orchestration, when the user requests a development team, or when work benefits from independent implementation and review; otherwise handle the request directly with the ordinary DSH tools your preset supplies. Read the injected DSH-global memory and applicable project instructions and skills before planning; preferences never replace permission, and dangerous operations still require a clear warning. Split work into non-overlapping module scopes, share docs/test/tests, cite a versioned specification, declare exact verification commands, and use Crew status revisions for every control action. A developer handoff is never accepted from prose alone: Crew verifies the checkout, runs declared commands, and starts a separate read-only reviewer. Integrate only reviewed work. Return after dispatch in a persistent host and let durable Crew notifications start follow-up turns; use crew_wait only when a one-shot host must remain in the current turn, and always re-read crew_status after it returns. Git is optional for local development: never require repository initialization, a first commit, or remote access to dispatch, review, or integrate. Honor requests to work without commits. crew_commit always asks the user for approval, creates one local commit containing only the passing integration\'s approved paths, and never pushes.'

const WORKER_POLICY = 'You are a DSH-native Crew worker. Use only the Crew tools exposed in this scope. File access is confined to the durable work assignment; test execution accepts only predeclared command ids. Do not use Git, raw shell commands, external CLIs, or unscoped filesystem tools. Before ending the turn, call crew_report exactly once with structured evidence. A developer reports ready or blocked; a reviewer or integrator reports passed or rejected.'

const ACTIVE_WAIT_STATUSES: ReadonlySet<TeamMemberView['status']> = new Set(['running', 'provisioning'])
const NO_ACTIVE_WORKER_MESSAGE = 'No native Crew worker is running or provisioning. Re-read crew_status instead of waiting.'

function hasActiveWorker(ctx: Context, caller: Agent): boolean {
  return ctx.agentTeams.listMembers(caller).some(member =>
    member.id !== caller.id && ACTIVE_WAIT_STATUSES.has(member.status))
}

interface CrewChangeWait {
  readonly result: Promise<TeamWaitResult>
  readonly cancel: () => void
}

function waitForCrewChange(ctx: Context, caller: Agent, timeoutMs: number, signal: AbortSignal): CrewChangeWait {
  let cancel = (): void => {}
  const result = new Promise<TeamWaitResult>((resolve, reject) => {
    let settled = false
    let stop = (): void => {}
    const finish = (settle: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      stop()
      settle()
    }
    const onAbort = (): void => {
      const reason: unknown = signal.reason
      finish(() => { reject(reason instanceof Error ? reason : new Error('Crew wait aborted', { cause: reason })) })
    }
    stop = ctx.on('session/event', (session, event) => {
      if (session.id === caller.id && event.type.startsWith('crew/')) {
        finish(() => { resolve({ timedOut: false }) })
      }
    })
    const timer = setTimeout(() => { finish(() => { resolve({ timedOut: true }) }) }, timeoutMs)
    signal.addEventListener('abort', onAbort, { once: true })
    cancel = () => { finish(() => { resolve({ timedOut: false }) }) }
    if (signal.aborted) onAbort()
  })
  return { result, cancel }
}

/** Wait across intermediate Team edges until the Crew needs manager action. */
async function waitForManagerAction(
  ctx: Context,
  caller: Agent,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<TeamWaitResult | { timedOut: false; noProgress: { reason: 'no-active-worker'; message: string } }> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    signal.throwIfAborted()
    const remaining = deadline - Date.now()
    if (remaining <= 0) return { timedOut: true }
    const pending = waitForCrewChange(ctx, caller, remaining, signal)
    const active = hasActiveWorker(ctx, caller)
    if (managerActionReady(ctx.crew.view(caller), active)) {
      pending.cancel()
      await pending.result
      return { timedOut: false }
    }
    if (!active && !expectsSettlingEdge(ctx.crew.view(caller))) {
      pending.cancel()
      await pending.result
      return {
        timedOut: false,
        noProgress: { reason: 'no-active-worker', message: NO_ACTIVE_WORKER_MESSAGE },
      }
    }
    const result = await pending.result
    if (result.timedOut) return result
  }
}

/** Canonical tool set for each Crew role, shared with profile validation. */
export const CREW_ROLE_TOOL_NAMES: Readonly<Record<CrewToolRole, readonly string[]>> = Object.freeze({
  manager: Object.freeze([
    'crew_read_file',
    'crew_list_files',
    'crew_write_file',
    'crew_edit_file',
    'crew_memory',
    'crew_dispatch',
    'crew_append',
    'crew_stop',
    'crew_status',
    'crew_wait',
    'crew_reassign',
    'crew_integrate',
    'crew_commit',
  ]),
  developer: Object.freeze([
    'crew_read_file',
    'crew_list_files',
    'crew_write_file',
    'crew_edit_file',
    'crew_run_test',
    'crew_report',
  ]),
  reviewer: Object.freeze(['crew_read_file', 'crew_list_files', 'crew_run_test', 'crew_report']),
  integrator: Object.freeze(['crew_read_file', 'crew_list_files', 'crew_write_file', 'crew_edit_file', 'crew_run_test', 'crew_report']),
})

function validateRoleTools(config: Config): void {
  for (const role of ['manager', 'developer', 'reviewer', 'integrator'] as const) {
    const configured = config.roleTools?.[role]
    if (configured === undefined || (configured.length === 0 && config.requireRolePresets !== true)) {
      if (config.requireRolePresets === true) {
        throw new Error(`tool-crew: required ${role} role preset is missing`)
      }
      continue
    }
    const expected = CREW_ROLE_TOOL_NAMES[role]
    if (configured.length !== expected.length
      || new Set(configured).size !== configured.length
      || configured.some((name, index) => name !== expected[index])) {
      throw new Error(`tool-crew: ${role} role preset must declare exactly: ${expected.join(', ')}`)
    }
  }
}

const COMMAND_PARAMETER = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true, description: 'Unique lower-kebab-case command id.' },
    argv: { type: 'array', required: true, items: { type: 'string' }, description: 'Exact shell-free argv. The program must be allowed by Crew configuration.' },
    cwd: { type: 'string', required: true, description: 'Repository-relative working directory.' },
    timeout_ms: { type: 'integer', required: true, description: 'Positive command timeout in milliseconds.' },
  },
} as const

const ISSUE_PARAMETER = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true, description: 'Repository-relative affected path.' },
    line: { type: 'integer', description: 'Optional one-based line number.' },
    message: { type: 'string', required: true, description: 'Concrete observed issue.' },
    expected: { type: 'string', required: true, description: 'Required correction or acceptance condition.' },
  },
} as const

const WORK_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    task_id: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    module_key: { type: 'string', required: true },
    stage: {
      type: 'string',
      required: true,
      enum: ['planned', 'queued', 'running', 'verifying', 'reviewing', 'revision_required', 'integration_ready', 'accepted', 'paused', 'failed', 'cancelled'],
    },
    reason: { type: 'string' },
    developer_session_id: { type: 'string' },
    reviewer_session_id: { type: 'string' },
    latest_verification_id: { type: 'string' },
    latest_review_id: { type: 'string' },
  },
} as const

const INTEGRATION_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    integration_id: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    status: { type: 'string', required: true, enum: ['running', 'passed', 'failed', 'cancelled'] },
    summary: { type: 'string', required: true },
    input_task_ids: { type: 'array', required: true, items: { type: 'string' } },
    approved_paths: { type: 'array', items: { type: 'string' } },
  },
} as const

const COMMIT_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    commit_id: { type: 'string', required: true },
    integration_id: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['committed', 'rejected'] },
    staged_paths: { type: 'array', required: true, items: { type: 'string' } },
    commit_hash: { type: 'string' },
    reason: { type: 'string' },
  },
} as const

const STATUS_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    configured: { type: 'boolean', required: true },
    repository_root: { type: 'string' },
    work_items: { type: 'array', required: true, items: WORK_RESULT_SCHEMA },
    integrations: { type: 'array', required: true, items: INTEGRATION_RESULT_SCHEMA },
    queued_notifications: { type: 'integer', required: true },
    commits: { type: 'array', required: true, items: COMMIT_RESULT_SCHEMA },
  },
} as const

const WAIT_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    timedOut: { type: 'boolean', required: true },
    noProgress: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: { type: 'string', required: true, const: 'no-active-worker' },
        message: { type: 'string', required: true },
      },
    },
  },
} as const

const FILE_READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    content: { type: 'string', required: true },
  },
} as const

const FILE_LIST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    entries: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          type: { type: 'string', required: true, enum: ['file', 'directory', 'other'] },
        },
      },
    },
  },
} as const

const WRITE_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    operation: { type: 'string', required: true, enum: ['create', 'update'] },
  },
} as const

const EDIT_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    replaced: { type: 'boolean', required: true, const: true },
  },
} as const

const COMMAND_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    command_id: { type: 'string', required: true },
    exit_code: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
    signal: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
    timed_out: { type: 'boolean', required: true },
    stdout: { type: 'string', required: true },
    stderr: { type: 'string', required: true },
    stdout_truncated: { type: 'boolean', required: true },
    stderr_truncated: { type: 'boolean', required: true },
  },
} as const

const REPORT_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    report_id: { type: 'string', required: true },
    role: { type: 'string', required: true, enum: ['developer', 'reviewer', 'integrator'] },
    verdict: { type: 'string', required: true, enum: ['ready', 'blocked', 'passed', 'rejected'] },
    task_id: { type: 'string' },
    integration_id: { type: 'string' },
  },
} as const

/** Declare one canonical output schema rendered as compact model-facing JSON. */
function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args: unknown, value: InferValue<S>) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

/** Recover the exact caller guaranteed by Agent-scoped tool discovery. */
function callingAgent(agent: Agent | undefined, toolName: string): Agent {
  /* v8 ignore next 2 -- Crew tools are registered only in an exact Agent scope. */
  if (agent === undefined) throw new Error(`${toolName} requires a calling Agent`)
  return agent
}

function command(command: { id: string; argv: string[]; cwd: string; timeout_ms: number }) {
  return { id: command.id, argv: command.argv, cwd: command.cwd, timeoutMs: command.timeout_ms }
}

function workResult(work: CrewWorkItemSnapshot): InferValue<typeof WORK_RESULT_SCHEMA> {
  return {
    task_id: work.taskId,
    revision: work.revision,
    module_key: work.moduleKey,
    stage: work.stage,
    ...(work.reason === undefined ? {} : { reason: work.reason }),
    ...(work.developerSessionId === undefined ? {} : { developer_session_id: work.developerSessionId }),
    ...(work.reviewerSessionId === undefined ? {} : { reviewer_session_id: work.reviewerSessionId }),
    ...(work.latestVerificationId === undefined ? {} : { latest_verification_id: work.latestVerificationId }),
    ...(work.latestReviewId === undefined ? {} : { latest_review_id: work.latestReviewId }),
  }
}

function integrationResult(integration: CrewIntegrationSnapshot): InferValue<typeof INTEGRATION_RESULT_SCHEMA> {
  return {
    integration_id: integration.id,
    revision: integration.revision,
    status: integration.status,
    summary: integration.summary,
    input_task_ids: integration.inputs.map(input => input.taskId),
    ...(integration.approvedPaths === undefined ? {} : { approved_paths: integration.approvedPaths }),
  }
}

function commitResult(commit: CrewCommitSnapshot): InferValue<typeof COMMIT_RESULT_SCHEMA> {
  return {
    commit_id: commit.id,
    integration_id: commit.integrationId,
    status: commit.status,
    staged_paths: commit.stagedPaths,
    ...(commit.commitHash === undefined ? {} : { commit_hash: commit.commitHash }),
    ...(commit.reason === undefined ? {} : { reason: commit.reason }),
  }
}

function statusResult(view: CrewView): InferValue<typeof STATUS_RESULT_SCHEMA> {
  return {
    configured: view.configured,
    ...(view.repositoryRoot === undefined ? {} : { repository_root: view.repositoryRoot }),
    work_items: view.workItems.map(workResult),
    integrations: view.integrations.map(integrationResult),
    queued_notifications: view.notifications.filter(item => item.status === 'queued').length,
    commits: view.commits.map(commitResult),
  }
}

function commandResult(result: CrewCommandResult): InferValue<typeof COMMAND_RESULT_SCHEMA> {
  return {
    command_id: result.commandId,
    exit_code: result.exitCode,
    signal: result.signal,
    timed_out: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr,
    stdout_truncated: result.stdoutTruncated,
    stderr_truncated: result.stderrTruncated,
  }
}

function reportResult(report: CrewReportSnapshot): InferValue<typeof REPORT_RESULT_SCHEMA> {
  return {
    report_id: report.id,
    role: report.role,
    verdict: report.verdict,
    ...(report.taskId === undefined ? {} : { task_id: report.taskId }),
    ...(report.integrationId === undefined ? {} : { integration_id: report.integrationId }),
  }
}

function installManager(agent: Agent, ctx: Context): () => void {
  const scoped = agent.ctx
  const disposers: Array<() => unknown> = []
  const register = (disposer: () => unknown): void => { disposers.push(disposer) }
  try {
    register(installManagerContext(agent, ctx))
    register(scoped.systemPrompt.section({
      name: 'crew:policy',
      order: scoped.systemPrompt.getSectionOrder('TEAM_POLICY'),
      text: MANAGER_POLICY,
    }))
    register(scoped.on('tools/pre-execute', (exec, next): Promise<PreToolDecision> => {
      if (exec.agent === agent && exec.name === 'crew_memory'
        && typeof exec.arguments === 'object' && exec.arguments !== null
        && 'operation' in exec.arguments && exec.arguments.operation === 'save'
        && 'kind' in exec.arguments && exec.arguments.kind === 'authorization') {
        return Promise.resolve({ kind: 'ask', reason: 'Save an explicit user-authorized scope in DSH global memory. Past approvals alone do not authorize this change; tool permission checks still apply.' })
      }
      if (exec.agent === agent && exec.name === 'crew_commit') {
        return Promise.resolve({
          kind: 'ask',
          reason: 'Create one local Git commit containing only the paths approved by the passing Crew integration. This never pushes.',
        })
      }
      return next()
    }))
    register(scoped.tools.register(defineTool({
      name: 'crew_memory',
      description: 'Read, save, or delete DSH user-global operating memory. Read first and use its revision for edits. Save observed preferences separately from explicit standing authorization; authorization always asks the user. Do not store secrets, project instructions, or task progress.',
      parameters: {
        operation: { type: 'string', required: true, enum: ['read', 'save', 'delete'] },
        entry_id: { type: 'string', description: 'Stable lower-kebab-case memory id; required for save and delete.' },
        expected_revision: { type: 'integer', description: 'Revision returned by the latest read; required for save and delete.' },
        kind: { type: 'string', enum: ['preference', 'authorization'], description: 'Required for save. Repeated approvals are preferences, not standing authorization.' },
        text: { type: 'string', description: 'Required for save; the user habit or explicit authorization to remember.' },
        scope: { type: 'string', description: 'Required for save; when and where the remembered choice applies.' },
      },
      output: jsonOutput({
        type: 'object', additionalProperties: false,
        properties: {
          revision: { type: 'integer', required: true },
          entries: { type: 'array', required: true, items: {
            type: 'object', additionalProperties: false,
            properties: {
              id: { type: 'string', required: true }, kind: { type: 'string', required: true, enum: ['preference', 'authorization'] },
              text: { type: 'string', required: true }, scope: { type: 'string', required: true },
            },
          } },
        },
      }),
      async execute(args, exec) {
        callingAgent(exec.agent, 'crew_memory')
        const preferences = ctx.get('crewPreferences')
        if (preferences === undefined) throw new Error('Crew global preferences are not composed; enable the Crew preferences plugin.')
        if (args.operation !== 'read') {
          if (args.entry_id === undefined || args.expected_revision === undefined) throw new Error('Memory edits require entry_id and expected_revision from a current read.')
          if (args.operation === 'delete') await preferences.deleteMemory(CrewMemoryId(args.entry_id), args.expected_revision)
          else {
            if (args.kind === undefined || args.text === undefined || args.scope === undefined) {
              throw new Error('Saving memory requires kind, text, and scope.')
            }
            await preferences.saveMemory(
              CrewMemoryId(args.entry_id), { kind: args.kind, text: args.text, scope: args.scope }, args.expected_revision,
            )
          }
        }
        const snapshot = preferences.snapshot()
        return { revision: snapshot.revision, entries: Object.entries(snapshot.memory).map(([id, entry]) => ({ id, ...entry })) }
      },
    })))
    register(scoped.tools.register(defineTool({
      name: 'crew_read_file',
      description: 'Read one bounded UTF-8 repository file through Crew path policy. Git metadata and credential files are unavailable.',
      parameters: { path: { type: 'string', required: true } },
      output: jsonOutput(FILE_READ_SCHEMA),
      async execute(args, exec) {
        return await ctx.crew.readManagerFile(callingAgent(exec.agent, 'crew_read_file'), args.path, exec.signal)
      },
    })))
    register(scoped.tools.register(defineTool({
      name: 'crew_list_files',
      description: 'List direct children of one repository directory through Crew path policy.',
      parameters: { path: { type: 'string', required: true } },
      output: jsonOutput(FILE_LIST_SCHEMA),
      async execute(args, exec) {
        return {
          path: args.path,
          entries: await ctx.crew.listManagerFiles(callingAgent(exec.agent, 'crew_list_files'), args.path, exec.signal),
        }
      },
    })))
    register(scoped.tools.register(defineTool({
      name: 'crew_write_file',
      description: 'Create or replace one UTF-8 repository file through Crew path policy without changing Git metadata.',
      parameters: {
        path: { type: 'string', required: true },
        content: { type: 'string', required: true },
      },
      output: jsonOutput(WRITE_RESULT_SCHEMA),
      async execute(args, exec) {
        return await ctx.crew.writeManagerFile(
          callingAgent(exec.agent, 'crew_write_file'),
          args.path,
          args.content,
          exec.signal,
        )
      },
    })))
    register(scoped.tools.register(defineTool({
      name: 'crew_edit_file',
      description: 'Apply one exact literal replacement to a repository file through Crew path policy.',
      parameters: {
        path: { type: 'string', required: true },
        old_string: { type: 'string', required: true },
        new_string: { type: 'string', required: true },
        replace_all: { type: 'boolean', description: 'Replace every occurrence; defaults to false.' },
      },
      output: jsonOutput(EDIT_RESULT_SCHEMA),
      async execute(args, exec) {
        return await ctx.crew.editManagerFile(
          callingAgent(exec.agent, 'crew_edit_file'),
          args.path,
          args.old_string,
          args.new_string,
          args.replace_all ?? false,
          exec.signal,
        )
      },
    })))
    register(scoped.tools.register(defineTool({
      name: 'crew_dispatch',
      description: 'Create one versioned Crew work item, freeze its checkout baseline, and start a DSH-native developer.',
      parameters: {
        module_key: { type: 'string', required: true, description: 'Stable lower-kebab-case module key.' },
        subject: { type: 'string', required: true, description: 'Concise work item title.' },
        description: { type: 'string', required: true, description: 'Complete implementation task and acceptance criteria.' },
        spec_path: { type: 'string', required: true, description: 'Repository-relative versioned specification path.' },
        spec_revision: { type: 'integer', required: true, description: 'Positive specification revision.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Completed Crew task ids required first.' },
        read_scopes: { type: 'array', required: true, items: { type: 'string' }, description: 'Repository-relative readable scopes.' },
        write_scopes: { type: 'array', required: true, items: { type: 'string' }, description: 'Non-overlapping repository-relative writable scopes.' },
        required_artifacts: { type: 'array', required: true, items: { type: 'string' }, description: 'Files that must exist at developer handoff.' },
        test_commands: { type: 'array', required: true, items: COMMAND_PARAMETER, description: 'Exact host verification commands.' },
      },
      output: jsonOutput(WORK_RESULT_SCHEMA),
      async execute(args, exec) {
        const result = await ctx.crew.dispatch(callingAgent(exec.agent, 'crew_dispatch'), {
          moduleKey: args.module_key,
          subject: args.subject,
          description: args.description,
          specPath: args.spec_path,
          specRevision: args.spec_revision,
          ...(args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) }),
          readScopes: args.read_scopes,
          writeScopes: args.write_scopes,
          requiredArtifacts: args.required_artifacts,
          testCommands: args.test_commands.map(command),
          signal: exec.signal,
        })
        return workResult(result)
      },
    })))
    register(scoped.tools.register(defineTool({
      name: 'crew_append',
      description: 'Continue the current durable developer with new instructions using the latest Crew work-item revision.',
      parameters: {
        task_id: { type: 'string', required: true },
        expected_revision: { type: 'integer', required: true },
        message: { type: 'string', required: true },
      },
      output: jsonOutput(WORK_RESULT_SCHEMA),
      async execute(args, exec) {
        return workResult(await ctx.crew.append(callingAgent(exec.agent, 'crew_append'), {
          taskId: TeamTaskId(args.task_id),
          expectedRevision: args.expected_revision,
          message: args.message,
          signal: exec.signal,
        }))
      },
    })))
    register(scoped.tools.register(defineTool({
      name: 'crew_stop',
      description: 'Interrupt and durably pause one active Crew work item without deleting its child Session.',
      parameters: {
        task_id: { type: 'string', required: true },
        expected_revision: { type: 'integer', required: true },
        reason: { type: 'string', required: true },
      },
      output: jsonOutput(WORK_RESULT_SCHEMA),
      async execute(args, exec) {
        return workResult(await ctx.crew.stop(callingAgent(exec.agent, 'crew_stop'), {
          taskId: TeamTaskId(args.task_id),
          expectedRevision: args.expected_revision,
          reason: args.reason,
        }))
      },
    })))
    register(scoped.tools.register(defineTool({
      name: 'crew_status',
      description: 'Read current Crew work, integration, notification, and commit revisions.',
      parameters: {},
      output: jsonOutput(STATUS_RESULT_SCHEMA),
      async execute(_args, exec) {
        return Promise.resolve(statusResult(ctx.crew.view(callingAgent(exec.agent, 'crew_status'))))
      },
    })))
    register(scoped.tools.register(defineTool({
      name: 'crew_wait',
      description: 'Wait without model polling for one Crew change or until the workflow needs manager action. Re-read crew_status after this returns.',
      parameters: {
        timeout_ms: {
          type: 'integer',
          description: 'Wait duration in milliseconds, from 10000 through 3600000. Defaults to 30000.',
        },
        until: {
          type: 'string',
          enum: ['change', 'manager-action'],
          description: 'Defaults to change. manager-action skips intermediate worker events until intervention, integration, or a terminal integration result is available.',
        },
      },
      output: jsonOutput(WAIT_RESULT_SCHEMA),
      async execute(args, exec) {
        const caller = callingAgent(exec.agent, 'crew_wait')
        const timeoutMs = args.timeout_ms ?? 30_000
        // Preserve the Team service's timeout validation before the model-only
        // no-progress shortcut.
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 3_600_000) {
          return await ctx.agentTeams.waitForChange(caller, timeoutMs, exec.signal)
        }
        if (args.until === 'manager-action') {
          return await waitForManagerAction(ctx, caller, timeoutMs, exec.signal)
        }
        if (!hasActiveWorker(ctx, caller)) {
          return {
            timedOut: false,
            noProgress: {
              reason: 'no-active-worker' as const,
              message: NO_ACTIVE_WORKER_MESSAGE,
            },
          }
        }
        return await ctx.agentTeams.waitForChange(caller, timeoutMs, exec.signal)
      },
    })))
    register(scoped.tools.register(defineTool({
      name: 'crew_reassign',
      description: 'Replace a paused, failed, or revision-required developer with a fresh DSH-native child.',
      parameters: {
        task_id: { type: 'string', required: true },
        expected_revision: { type: 'integer', required: true },
        reason: { type: 'string', required: true },
      },
      output: jsonOutput(WORK_RESULT_SCHEMA),
      async execute(args, exec) {
        return workResult(await ctx.crew.reassign(callingAgent(exec.agent, 'crew_reassign'), {
          taskId: TeamTaskId(args.task_id),
          expectedRevision: args.expected_revision,
          reason: args.reason,
          signal: exec.signal,
        }))
      },
    })))
    register(scoped.tools.register(defineTool({
      name: 'crew_integrate',
      description: 'Start a native integrator to connect reviewed modules, make necessary project edits, and run combined tests.',
      parameters: {
        task_ids: { type: 'array', items: { type: 'string' }, description: 'Reviewed task ids; omit to select every integration-ready task.' },
        test_commands: { type: 'array', required: true, items: COMMAND_PARAMETER, description: 'Exact combined verification commands.' },
      },
      output: jsonOutput(INTEGRATION_RESULT_SCHEMA),
      async execute(args, exec) {
        return integrationResult(await ctx.crew.integrate(callingAgent(exec.agent, 'crew_integrate'), {
          ...(args.task_ids === undefined ? {} : { taskIds: args.task_ids.map(TeamTaskId) }),
          testCommands: args.test_commands.map(command),
          signal: exec.signal,
        }))
      },
    })))
    register(scoped.tools.register(defineTool({
      name: 'crew_commit',
      description: 'After user approval, commit only the exact paths from one passing Crew integration. This never pushes.',
      parameters: {
        integration_id: { type: 'string', required: true },
        message: { type: 'string', required: true },
      },
      output: jsonOutput(COMMIT_RESULT_SCHEMA),
      async execute(args, exec) {
        const caller = callingAgent(exec.agent, 'crew_commit')
        return commitResult(await executeApprovedCrewCommit(ctx.crew, caller, {
          integrationId: CrewIntegrationId(args.integration_id),
          message: args.message,
          approvalCallId: String(exec.callId),
          signal: exec.signal,
        }))
      },
    })))
  } catch (error: unknown) {
    for (const dispose of disposers.reverse()) void dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) void dispose()
  }
}

function installWorker(agent: Agent, ctx: Context, binding: CrewWorkerBinding): () => void {
  const scoped = agent.ctx
  const disposers: Array<() => unknown> = []
  const register = (disposer: () => unknown): void => { disposers.push(disposer) }
  try {
    register(scoped.systemPrompt.section({
      name: 'crew:policy',
      order: scoped.systemPrompt.getSectionOrder('TEAM_POLICY'),
      text: `${WORKER_POLICY}\n\nYour Crew role is ${binding.role}.`,
    }))
    register(scoped.tools.register(defineTool({
      name: 'crew_read_file',
      description: 'Read one bounded UTF-8 text file inside the current durable Crew read scopes.',
      parameters: { path: { type: 'string', required: true } },
      output: jsonOutput(FILE_READ_SCHEMA),
      async execute(args, exec) {
        return await ctx.crew.readWorkerFile(callingAgent(exec.agent, 'crew_read_file'), args.path, exec.signal)
      },
    })))
    register(scoped.tools.register(defineTool({
      name: 'crew_list_files',
      description: 'List direct children of one directory inside the current durable Crew read scopes.',
      parameters: { path: { type: 'string', required: true } },
      output: jsonOutput(FILE_LIST_SCHEMA),
      async execute(args, exec) {
        return {
          path: args.path,
          entries: await ctx.crew.listWorkerFiles(callingAgent(exec.agent, 'crew_list_files'), args.path, exec.signal),
        }
      },
    })))
    if (binding.role !== 'reviewer') {
      register(scoped.tools.register(defineTool({
        name: 'crew_write_file',
        description: 'Create or replace one UTF-8 text file inside the current durable Crew write scopes.',
        parameters: {
          path: { type: 'string', required: true },
          content: { type: 'string', required: true },
        },
        output: jsonOutput(WRITE_RESULT_SCHEMA),
        async execute(args, exec) {
          return await ctx.crew.writeWorkerFile(callingAgent(exec.agent, 'crew_write_file'), args.path, args.content, exec.signal)
        },
      })))
      register(scoped.tools.register(defineTool({
        name: 'crew_edit_file',
        description: 'Apply one exact literal replacement inside the current durable Crew write scopes.',
        parameters: {
          path: { type: 'string', required: true },
          old_string: { type: 'string', required: true },
          new_string: { type: 'string', required: true },
          replace_all: { type: 'boolean', description: 'Replace every occurrence; defaults to false.' },
        },
        output: jsonOutput(EDIT_RESULT_SCHEMA),
        async execute(args, exec) {
          return await ctx.crew.editWorkerFile(
            callingAgent(exec.agent, 'crew_edit_file'),
            args.path,
            args.old_string,
            args.new_string,
            args.replace_all ?? false,
            exec.signal,
          )
        },
      })))
    }
    register(scoped.tools.register(defineTool({
      name: 'crew_run_test',
      description: 'Run a manager-declared test in the actual project with installed dependencies, bounded output and cancellation. Generated files persist. Additional commands require manager coordination.',
      parameters: { command_id: { type: 'string', required: true } },
      output: jsonOutput(COMMAND_RESULT_SCHEMA),
      async execute(args, exec) {
        const run = await ctx.crew.runWorkerTest(callingAgent(exec.agent, 'crew_run_test'), args.command_id, exec.signal)
        return commandResult(run.result)
      },
    })))
    register(scoped.tools.register(defineTool({
      name: 'crew_report',
      description: 'Persist the current Crew worker\'s single structured handoff for this binding revision.',
      parameters: {
        verdict: { type: 'string', required: true, enum: ['ready', 'blocked', 'passed', 'rejected'] },
        summary: { type: 'string', required: true },
        changed_paths: { type: 'array', required: true, items: { type: 'string' } },
        issues: { type: 'array', required: true, items: ISSUE_PARAMETER },
        verification_id: { type: 'string', description: 'Required only for a reviewer; use the current verification id.' },
      },
      output: jsonOutput(REPORT_RESULT_SCHEMA),
      async execute(args, exec) {
        return reportResult(await ctx.crew.recordReport(callingAgent(exec.agent, 'crew_report'), {
          verdict: args.verdict,
          summary: args.summary,
          changedPaths: args.changed_paths,
          issues: args.issues,
          ...(args.verification_id === undefined ? {} : { verificationId: CrewVerificationId(args.verification_id) }),
        }))
      },
    })))
  } catch (error: unknown) {
    for (const dispose of disposers.reverse()) void dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) void dispose()
  }
}

function reservedWorkerBinding(agent: Agent, ctx: Context): CrewWorkerBinding | undefined {
  const membership = ctx.agentTeams.tryMembership(agent)
  if (membership === undefined || membership.role !== 'teammate') return undefined
  const state = ctx.crew.stateFor(membership.root)
  const work = state.workItems.find(item => item.developerSessionId === agent.id && item.stage === 'queued')
  if (work === undefined) return undefined
  return {
    role: 'developer',
    rootSessionId: membership.root.id,
    taskId: work.taskId,
    workItemRevision: work.revision,
  }
}

/** Install manager or worker tools in every current and subsequently published Crew Agent scope. */
export function apply(ctx: Context, config: Config = {}): void {
  validateRoleTools(config)
  const installed = new Map<Agent, () => void>()
  const maybeInstall = (agent: Agent): void => {
    if (installed.has(agent)) return
    const membership = ctx.agentTeams.tryMembership(agent)
    if (membership === undefined) return
    if (membership.role === 'lead') {
      installed.set(agent, installManager(agent, ctx))
      return
    }
    try {
      installed.set(agent, installWorker(agent, ctx, ctx.crew.workerBinding(agent)))
    } catch (_workerNotRunningYet) {
      // A developer Agent is published while its reserved work item can still
      // be queued. Its exact durable child id authorizes that provisioning
      // interval, and every operation rechecks the current binding.
      const reserved = reservedWorkerBinding(agent, ctx)
      if (reserved !== undefined) installed.set(agent, installWorker(agent, ctx, reserved))
    }
  }
  const sweep = (): void => {
    for (const agent of ctx.agents.list()) maybeInstall(agent)
  }
  sweep()
  ctx.on('agent/created', ({ agent }) => { maybeInstall(agent) })
  ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.()
    installed.delete(agent)
  })
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'crew/work-item' || event.type === 'crew/integration') sweep()
  })
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }, 'tool-crew.scopedTools()')
}
