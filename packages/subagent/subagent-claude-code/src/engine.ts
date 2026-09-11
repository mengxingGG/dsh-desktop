/** Persistent Claude Code execution provider using the scoped DSH tool composition. */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentExecutionRequest, AgentExecutionResult } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId, type LlmResolvedModelInfo, type MessageId } from '@deepseek-ai/dsh-llm'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subprocess'
import { foldClaudeQuota, parseClaudeAccount, parseClaudeUsage, type ClaudeAccountStatus, type ClaudeQuotaSnapshot } from './engine-account.ts'
import type { ClaudeSessionId } from './engine-events.ts'
export type { ClaudeSessionId } from './engine-events.ts'
import { openManagedClaudeQuery } from './engine-query.ts'
import { ClaudeEngineTools } from './engine-tools.ts'
import { ClaudeEngineTranscript } from './engine-stream.ts'
import { ClaudeOperations } from './engine-lifecycle.ts'
import { ClaudeUsageCollector, claudeUsageProjection } from './engine-usage.ts'
import type {} from '@deepseek-ai/dsh-session-projection'
import { claudePrompt } from './engine-content.ts'
import { ClaudeLogin, type ClaudeLoginId, type ClaudeLoginSnapshot } from './engine-login.ts'

/** CLI installation, account location and bounded auxiliary-operation settings. */
export interface Config {
  /** Native executable override; omission uses the pinned SDK's platform payload. */
  executable?: string
  /** Claude-owned account and conversation directory; omission uses its native default. */
  configDir?: string
  /** Explicit child environment layered over credential-scrubbed inheritance. */
  env: Record<string, string>
  /** Maximum wait for non-inference account and model-directory operations. */
  accountTimeoutMs: number
  /** Maximum captured bytes for account command output. */
  accountOutputBytes: number
  /** Whole-process-range termination grace. */
  disposeGraceMs: number
  /** Maximum lifetime of a user-initiated browser login. */
  loginTimeoutMs: number
  /** Maximum native model iterations inside one admitted DSH step. */
  maxTurns: number
}

export const Config: z<Config> = z.object({
  executable: z.string().min(1), configDir: z.string().min(1),
  env: z.dict(z.string()).default({}),
  accountTimeoutMs: z.number().min(1).default(30_000),
  accountOutputBytes: z.number().min(1).default(64 * 1024),
  disposeGraceMs: z.number().min(0).default(3_000),
  loginTimeoutMs: z.number().min(1).default(600_000),
  maxTurns: z.number().step(1).min(1).default(50),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    claudeCode: ClaudeCodeEngine
  }
}

/** Owns CLI account observations and persistent execution for main and Crew Agents. */
export class ClaudeCodeEngine extends TypertRemoteService<Config> {
  static inject = ['agents', 'subprocess', 'sessionProjections']
  static Config = Config
  private quotaValue: ClaudeQuotaSnapshot | null = null
  private executableValue: string | undefined
  private readonly operations: ClaudeOperations
  private modelDirectory: Promise<readonly LlmResolvedModelInfo[]> | undefined
  private readonly login = new ClaudeLogin()
  private executing = 0
  private accountIdentity: string | undefined

  constructor(ctx: Context, readonly config: Config) {
    super(ctx, 'claudeCode')
    this.operations = new ClaudeOperations(ctx)
    ctx.sessionProjections.register(claudeUsageProjection)
    ctx.agents.registerExecutor({
      id: 'claude-code', name: 'Claude Code',
      models: () => this.models(), execute: input => this.execute(input),
    })
  }

  private options(cwd: string, controller: AbortController): Options {
    return {
      cwd, abortController: controller,
      env: { ...scrubbedParentEnv(), ...this.config.env,
        ...this.config.configDir === undefined ? {} : { CLAUDE_CONFIG_DIR: this.config.configDir } },
      ...this.config.executable === undefined ? {} : { pathToClaudeCodeExecutable: this.config.executable },
      settingSources: [], tools: [], skills: [], strictMcpConfig: true,
      settings: { autoMemoryEnabled: false },
    }
  }

  /**
   * Read model choices from the installed native CLI without inference.
   * @returns canonical model ids and native reasoning choices.
   */
  async models(): Promise<readonly LlmResolvedModelInfo[]> {
    this.modelDirectory ??= this.operations.run(controller => this.discoverModels(controller)).catch((error: unknown) => {
      this.modelDirectory = undefined
      throw error
    })
    return this.modelDirectory
  }

  private async discoverModels(controller: AbortController): Promise<readonly LlmResolvedModelInfo[]> {
    const timer = setTimeout(() =>{  controller.abort() }, this.config.accountTimeoutMs)
    const inputDone = Promise.withResolvers<void>()
    async function* input(): AsyncGenerator<SDKUserMessage> { await inputDone.promise }
    let owned: Awaited<ReturnType<typeof openManagedClaudeQuery>> | undefined
    try {
      owned = await openManagedClaudeQuery(input(), { ...this.options(homedir(), controller), persistSession: false },
        spec => this.ctx.subprocess.spawn(spec), this.config.disposeGraceMs)
      this.executableValue = owned.executable
      const models = await owned.query.supportedModels()
      const unique = new Map<string, LlmResolvedModelInfo>()
      for (const model of models) {
        const id = model.resolvedModel ?? model.value
        unique.set(id, { provider: 'claude-code', id, name: model.displayName, description: model.description,
          ...model.supportedEffortLevels === undefined ? {} : {
            reasoning: { efforts: model.supportedEffortLevels.map(effort => ({ id: ReasoningEffortId(effort), name: effort })) },
          },
        })
      }
      return [...unique.values()]
    } finally {
      clearTimeout(timer)
      inputDone.resolve()
      await owned?.close()
    }
  }

  /**
   * Query native authentication without reading or returning credentials.
   * @returns public account status; command and parse failures reject.
   */
  async account(): Promise<ClaudeAccountStatus> {
    const account = await this.operations.run(controller => this.readAccount(controller))
    const identity = JSON.stringify(account)
    if (this.accountIdentity !== undefined && identity !== this.accountIdentity) {
      this.quotaValue = null
      this.modelDirectory = undefined
      this.ctx.agents.notifyExecutors()
    }
    this.accountIdentity = identity
    return account
  }

  private async readAccount(controller: AbortController): Promise<ClaudeAccountStatus> {
    if (this.executableValue === undefined) await this.models()
    const executable = this.executableValue
    if (executable === undefined) throw new Error('Claude executable has not been resolved')
    const timer = setTimeout(() =>{  controller.abort() }, this.config.accountTimeoutMs)
    const child = this.ctx.subprocess.spawn({
      argv: [executable, 'auth', 'status', '--json'], cwd: homedir(),
      env: this.options(homedir(), controller).env,
      graceMs: this.config.disposeGraceMs, signal: controller.signal,
      stdio: { stdin: 'ignore', stdout: { maxBytes: this.config.accountOutputBytes }, stderr: { maxBytes: this.config.accountOutputBytes } },
    })
    try {
      await child.done
      controller.signal.throwIfAborted()
      const output = child.collected.stdout?.readFrom(0)
      if (output === undefined || output.lossy) throw new Error('Claude account response is unavailable or truncated')
      return parseClaudeAccount(output.text)
    } finally {
      clearTimeout(timer)
      child.terminate()
      await child.waitForExit()
    }
  }

  /**
   * Read the most recent observed quota without spending an inference request.
   * @returns account windows with their observation times, or null before an observation.
   */
  quota(): ClaudeQuotaSnapshot | null { return this.quotaValue }

  /**
   * Read plan quota through the pinned native usage command without an inference prompt.
   * @param signal - Remote caller cancellation.
   * @returns current plan windows, or null when the native account cannot provide them.
   */
  @Remote('refreshQuota')
  async refreshQuota(signal: AbortSignal): Promise<ClaudeQuotaSnapshot | null> {
    return this.operations.run(async (controller) => {
      const timer = setTimeout(() =>{  controller.abort() }, this.config.accountTimeoutMs)
      const done = Promise.withResolvers<void>()
      async function* input(): AsyncGenerator<SDKUserMessage> { await done.promise }
      let owned: Awaited<ReturnType<typeof openManagedClaudeQuery>> | undefined
      try {
        owned = await openManagedClaudeQuery(input(), { ...this.options(homedir(), controller), persistSession: false },
          spec => this.ctx.subprocess.spawn(spec), this.config.disposeGraceMs)
        this.executableValue = owned.executable
        const usage = await owned.query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()
        this.quotaValue = parseClaudeUsage(usage, Date.now())
        return this.quotaValue
      } finally {
        clearTimeout(timer)
        done.resolve()
        await owned?.close()
      }
    }, signal)
  }

  /**
   * Refresh public account status and read the latest quota observation.
   * @returns account facts, cached quota, and any native login attempt.
   */
  @Remote('status')
  async status(): Promise<{ account: ClaudeAccountStatus; quota: ClaudeQuotaSnapshot | null; login: ClaudeLoginSnapshot | null }> {
    return { account: await this.account(), quota: this.quota(), login: this.login.snapshot() }
  }

  /**
   * Begin the official browser authorization process.
   * @returns bounded native output and the login identity for subsequent input.
   */
  @Remote('startLogin')
  async startLogin(): Promise<ClaudeLoginSnapshot> {
    if (this.executing > 0) throw new Error('Stop active Claude Agents before changing the Claude account')
    if (this.executableValue === undefined) await this.models()
    if (this.executableValue === undefined) throw new Error('Claude executable is unavailable')
    const env = { ...this.options(homedir(), new AbortController()).env }
    for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']) env[key] = undefined
    this.modelDirectory = undefined
    this.quotaValue = null
    return this.login.start(this.operations, spec => this.ctx.subprocess.spawn(spec), {
      argv: [this.executableValue, 'auth', 'login'], cwd: homedir(), env,
      graceMs: this.config.disposeGraceMs,
      stdio: { stdin: 'pipe', stdout: { maxBytes: this.config.accountOutputBytes }, stderr: { maxBytes: this.config.accountOutputBytes } },
    }, this.config.loginTimeoutMs)
  }

  /**
   * Read the most recent native authorization attempt.
   * @returns bounded progress for the current native login, without starting a process.
   */
  @Remote('loginStatus')
  loginStatus(): ClaudeLoginSnapshot | null { return this.login.snapshot() }

  /**
   * Submit the native login response without retaining its contents.
   * @param id - attempt displayed by the settings view.
   * @param code - user-entered authorization response.
   * @returns fulfillment after input delivery.
   */
  @Remote('loginInput')
  async loginInput(id: ClaudeLoginId, code: string): Promise<void> { await this.login.input(id, code) }

  /**
   * Cancel the displayed native login and drain its process range.
   * @param id - exact attempt displayed by the settings view.
   * @returns fulfillment after native process cleanup.
   */
  @Remote('cancelLogin')
  async cancelLogin(id: ClaudeLoginId): Promise<void> { await this.login.cancel(id) }

  private async execute(input: AgentExecutionRequest): Promise<AgentExecutionResult> {
    if (this.login.snapshot()?.status === 'running') throw new Error('Complete or cancel Claude login before starting an Agent')
    this.executing += 1
    try {
      return await this.operations.run(async (controller) => {
        const abort = () => { if (!input.request.signal?.aborted) input.agent.cancel({ kind: 'hook', reason: 'Claude Code executor stopped' }) }
        controller.signal.addEventListener('abort', abort, { once: true })
        try { return await this.executeOwned(input, controller) }
        finally { controller.signal.removeEventListener('abort', abort) }
      }, input.request.signal)
    } finally { this.executing -= 1 }
  }

  private async executeOwned(input: AgentExecutionRequest, controller: AbortController): Promise<AgentExecutionResult> {
    const { agent, request } = input
    if (request.temperature !== undefined || request.stop !== undefined) {
      throw new Error('Claude Code does not expose temperature or stop-sequence overrides')
    }
    const cwd = agent.session.header.cwd
    if (cwd === undefined) throw new Error('Claude Code requires a Session workspace')
    const events = agent.session.snapshotEvents()
    const binding = events.findLast(event => event.type === 'claude-code/binding')
    const checkpoint = events.findLast(event => event.type === 'claude-code/checkpoint')
    const lastPrompt = events.findLast(event => event.type === 'claude-code/prompt')
    const synchronized = checkpoint?.type === 'claude-code/checkpoint'
      && lastPrompt !== undefined && checkpoint.seq > lastPrompt.seq
      && checkpoint.data.messageIds.every((id, index) => request.messages[index]?.id === id)
      && request.messages.slice(checkpoint.data.messageIds.length).every(message => message.role === 'user' && message.source.kind !== 'tool')
    const previous = binding?.type === 'claude-code/binding'
      && binding.data.ownerSessionId === agent.session.id && synchronized
      && binding.data.sessionId === checkpoint.data.sessionId ? binding.data : undefined
    const sessionId = previous?.sessionId ?? randomUUID() as ClaudeSessionId
    if (previous !== undefined && previous.configDir !== (this.config.configDir ?? null)) {
      throw new Error('Claude account directory differs from this Session binding')
    }
    const consumed = new Set<MessageId>(events.flatMap(event =>
      event.type === 'claude-code/input' && event.data.sessionId === sessionId ? event.data.messageIds : []))
    const messages = request.messages.filter(message => !consumed.has(message.id)
      && (previous === undefined || (message.role === 'user' && message.source.kind !== 'tool')))
    agent.session.append('claude-code/prompt', { sessionId, messages, bootstrap: previous === undefined })
    const message = await claudePrompt(agent.ctx, messages, controller.signal)
    // oxlint-disable-next-line typescript/require-await -- the SDK requires an async iterable for structured input.
    async function* prompt(): AsyncGenerator<SDKUserMessage> {
      yield { type: 'user', session_id: sessionId, parent_tool_use_id: null, message }
    }
    const tools = new ClaudeEngineTools(input)
    const transcript = new ClaudeEngineTranscript(input)
    const lastUsage = events.findLast(event => event.type === 'claude-code/usage')
    const usage = new ClaudeUsageCollector(request.model, lastUsage?.data ?? null)
    let owned: Awaited<ReturnType<typeof openManagedClaudeQuery>> | undefined
    let admitted = false
    try {
      owned = await openManagedClaudeQuery(prompt(), {
        ...this.options(cwd, controller), model: request.model,
        maxTurns: this.config.maxTurns,
        env: { ...this.options(cwd, controller).env,
          ...request.maxTokens === undefined ? {} : { CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(request.maxTokens) } },
        systemPrompt: request.system ?? '', persistSession: true, includePartialMessages: true,
        ...previous === undefined ? { sessionId } : { resume: sessionId },
        ...(request.reasoningEffort === undefined ? {} : { effort: request.reasoningEffort as NonNullable<Options['effort']> }),
        mcpServers: { dsh: tools.config },
        permissionMode: 'default',
        canUseTool: (name, args) => Promise.resolve((request.tools ?? []).some(tool => name === `mcp__dsh__${tool.name}`)
          ? { behavior: 'allow', updatedInput: args }
          : { behavior: 'deny', message: 'Only the scoped DSH tool composition is available.' }),
      }, spec => this.ctx.subprocess.spawn(spec), this.config.disposeGraceMs)
      for await (const message of owned.query) {
        if (message.type === 'system' && message.subtype === 'init' && !admitted) {
          if (message.session_id !== sessionId) throw new Error('Claude initialized an unexpected conversation')
          if (previous === undefined) agent.session.append('claude-code/binding', {
            sessionId, ownerSessionId: agent.session.id, cliVersion: message.claude_code_version, configDir: this.config.configDir ?? null,
          })
          agent.session.append('claude-code/input', { sessionId, messageIds: messages.map(item => item.id) })
          admitted = true
        }
        if (message.type === 'rate_limit_event') {
          this.quotaValue = foldClaudeQuota(message.rate_limit_info, this.quotaValue, Date.now())
          agent.session.append('claude-code/quota', this.quotaValue)
        }
        const measurement = usage.accept(message)
        if (measurement !== undefined) agent.session.append('claude-code/usage', measurement)
        tools.observe(transcript.accept(message))
        if (message.type === 'result') {
          if (message.subtype !== 'success' || message.is_error) {
            const detail = message.subtype === 'success' ? message.result : message.errors.join('; ')
            throw new Error(`Claude Code execution failed: ${detail || message.subtype}`)
          }
          agent.session.append('claude-code/checkpoint', { sessionId, messageIds: agent.session.deriveMessages().map(message => message.id) })
          return { kind: 'completed' }
        }
      }
      throw new Error('Claude Code exited without a completed result')
    } finally {
      const releases = await Promise.allSettled([owned?.close(), tools.close()])
      const failures: unknown[] = []
      for (const result of releases) if (result.status === 'rejected') failures.push(result.reason)
      if (failures.length > 0) throw new AggregateError(failures, 'Claude execution cleanup failed')
    }
  }
}

export default ClaudeCodeEngine
