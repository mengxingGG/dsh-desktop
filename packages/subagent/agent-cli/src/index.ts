/** Native CLI execution through DSH-owned tools and Session history. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { z as wire } from 'zod'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import assert from 'node:assert/strict'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { AgentExecutionRequest, AgentExecutionResult } from '@deepseek-ai/dsh-agent'
import { ToolCallId, type LlmResolvedModelInfo, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-subprocess'
import { BRIDGE_INSTRUCTIONS, outputSchema, parseModels, parseQuota, parseResponse, usageSample } from './protocol.ts'
import { CliRuntime, executable } from './runtime.ts'
import { cliUsageProjection } from './projection.ts'
import { CODEX_RESTRICTIONS, inspectCodex, readCodexQuota, runCodex } from './codex.ts'
import { codexUsage } from './codex-protocol.ts'
import type { CliProvider, CliConversationId, CliLoginId, CliLoginSnapshot, CliAccountStatus, CliQuotaWindow } from './types.ts'
import type {} from './events.ts'

/** Deployment-owned native binary paths and resource limits. */
export interface Config {
  /** Optional absolute Grok executable override. */
  grokExecutable?: string
  /** Optional absolute Antigravity executable override. */
  antigravityExecutable?: string
  /** Optional absolute Codex executable override. */
  codexExecutable?: string
  /** Private generated-agent and native conversation working directories. */
  runtimeRoot: string
  /** Native global agent directory; only a DSH-namespaced definition is written. */
  antigravityAgentRoot: string
  /** Explicit child environment; native credentials remain CLI-owned. */
  env: Record<string, string>
  /** Timeout for account and model discovery without inference. */
  accountTimeoutMs: number
  /** Native request deadline, excluding subsequent DSH tool execution. */
  requestTimeoutMs: number
  /** Maximum captured stdout or stderr bytes per native invocation. */
  outputBytes: number
  /** Maximum serialized input bytes, including schemas and history. */
  inputBytes: number
  /** Process-range termination grace. */
  disposeGraceMs: number
  /** Maximum user-controlled login terminal lifetime. */
  loginTimeoutMs: number
}
export const Config: z<Config> = z.object({
  grokExecutable: z.string().min(1), antigravityExecutable: z.string().min(1),
  codexExecutable: z.string().min(1),
  runtimeRoot: z.string().min(1).default(join(homedir(), '.dsh', 'cli-runtime')),
  antigravityAgentRoot: z.string().min(1).default(join(homedir(), '.gemini', 'config', 'agents')),
  env: z.dict(z.string()).default({}),
  accountTimeoutMs: z.number().min(1).default(30_000),
  requestTimeoutMs: z.number().min(1).default(1_800_000),
  outputBytes: z.number().min(1024).default(4 * 1024 * 1024),
  inputBytes: z.number().min(1024).default(8 * 1024 * 1024),
  disposeGraceMs: z.number().min(1).default(3_000),
  loginTimeoutMs: z.number().min(1).default(600_000),
})
declare module '@deepseek-ai/cordis' { interface Context { cliAgents: CliAgents } }

const PROVIDERS = ['grok-cli', 'antigravity-cli', 'codex-cli'] as const
const PROVIDER_NAMES: Readonly<Record<CliProvider, string>> = { 'grok-cli': 'Grok CLI', 'antigravity-cli': 'Antigravity CLI', 'codex-cli': 'Codex CLI' }
const counters = wire.record(wire.string(), wire.number().finite().nonnegative())
const grokResult = wire.object({
  sessionId: wire.string().min(1), text: wire.string().optional(), structured_output: wire.unknown().optional(),
  stopReason: wire.string().optional(), usage: counters.optional(), total_cost_usd: wire.number().nonnegative().optional(),
})
const agyResult = wire.object({
  conversation_id: wire.string().min(1), status: wire.string(), response: wire.string().optional(),
  error: wire.string().optional(), structured_output: wire.unknown().optional(), usage: counters.optional(),
  denied_actions: wire.array(wire.unknown()).optional(),
})

/** Publishes execution routes, native account controls and invocation usage. */
export class CliAgents extends TypertRemoteService<Config> {
  static inject = ['agents', 'subprocess', 'sessionProjections']
  static Config = Config
  private readonly runtime: CliRuntime
  private readonly directories = new Map<CliProvider, Promise<readonly LlmResolvedModelInfo[]>>()
  private readonly accountValues = new Map<CliProvider, CliAccountStatus>()
  private readonly executing = new Set<CliProvider>()
  private readonly counts = new Map<CliProvider, number>()
  private readonly loginStarts = new Map<CliProvider, Promise<CliLoginSnapshot>>()

  constructor(ctx: Context, readonly config: Config) {
    super(ctx, 'cliAgents')
    if (!isAbsolute(config.runtimeRoot)) throw new Error('CLI runtimeRoot must be absolute')
    if (!isAbsolute(config.antigravityAgentRoot)) throw new Error('Antigravity agent directory must be absolute')
    this.runtime = new CliRuntime(ctx, config)
    ctx.sessionProjections.register(cliUsageProjection)
    for (const provider of PROVIDERS) ctx.agents.registerExecutor({
      id: provider, name: PROVIDER_NAMES[provider],
      models: () => this.models(provider), execute: input => this.execute(provider, input),
    })
  }

  private binary(provider: CliProvider): Promise<string> {
    return executable(provider, provider === 'grok-cli' ? this.config.grokExecutable
      : provider === 'codex-cli' ? this.config.codexExecutable : this.config.antigravityExecutable)
  }
  private empty(provider: CliProvider): CliAccountStatus {
    return { provider, installed: false, authenticated: null, modelCount: 0, error: null,
      quota: null, quotaObservedAt: null, login: null }
  }
  private models(provider: CliProvider): Promise<readonly LlmResolvedModelInfo[]> {
    let value = this.directories.get(provider)
    if (!value) {
      value = this.runtime.run(async (controller) => {
        let installed = false
        try {
          const binary = await this.binary(provider)
          installed = true
          if (provider === 'codex-cli') {
            const native = await inspectCodex(this.ctx, binary, homedir(), this.config, controller.signal)
            this.accountValues.set(provider, { ...this.accountValues.get(provider) ?? this.empty(provider),
              installed, authenticated: native.authenticated, modelCount: native.models.length, error: null })
            return native.models
          }
          const result = await this.runtime.command([binary, 'models'], homedir(), controller.signal, this.config.accountTimeoutMs)
          if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || 'Native model discovery failed')
          const models = parseModels(provider, result.stdout).map(model => ({ provider, ...model }))
          if (!models.length) throw new Error('CLI returned no recognizable model directory')
          // Grok can expose a local directory even when its auxiliary command cannot verify OAuth.
          this.accountValues.set(provider, { ...this.accountValues.get(provider) ?? this.empty(provider),
            installed, authenticated: null, modelCount: models.length, error: null })
          return models
        } catch (error) {
          this.accountValues.set(provider, { ...this.accountValues.get(provider) ?? this.empty(provider),
            installed, authenticated: null, modelCount: 0, error: error instanceof Error ? error.message : String(error) })
          return []
        }
      })
      this.directories.set(provider, value)
    }
    return value
  }

  /**
   * Read cached native observations; no account probe starts implicitly.
   * @param provider - Selected native account.
   * @returns Latest account, model and login observations.
   */
  @Remote('status')
  status(provider: CliProvider): CliAccountStatus {
    return { ...this.accountValues.get(provider) ?? this.empty(provider), login: this.runtime.login(provider) }
  }

  /**
   * Refresh model availability without a model prompt or credential-file reads.
   * @param provider - Selected native account.
   * @returns Current native account observations.
   */
  @Remote('refresh')
  async refresh(provider: CliProvider): Promise<CliAccountStatus> {
    this.directories.delete(provider)
    await this.models(provider)
    this.ctx.agents.notifyExecutors()
    return this.status(provider)
  }

  /**
   * Start native device authorization or the Antigravity login terminal.
   * @param provider - User-selected account.
   * @returns Bounded login terminal output.
   */
  @Remote('startLogin')
  async startLogin(provider: CliProvider): Promise<CliLoginSnapshot> {
    if (this.executing.has(provider)) throw new Error('Stop active Agents before changing their CLI account')
    const pending = this.loginStarts.get(provider)
    if (pending) return pending
    const work = (async () => {
      const binary = await this.binary(provider)
      return this.runtime.startLogin(provider, provider === 'grok-cli' || provider === 'codex-cli' ? [binary, 'login', '--device-auth'] : [binary])
    })()
    this.loginStarts.set(provider, work)
    try { return await work }
    finally { this.loginStarts.delete(provider); this.directories.delete(provider) }
  }

  /**
   * Forward explicit user input to a native authorization terminal.
   * @param provider - Account shown in settings.
   * @param id - Displayed login identity.
   * @param text - Explicit terminal input.
   * @returns Completion after input delivery.
   */
  @Remote('loginInput')
  async loginInput(provider: CliProvider, id: CliLoginId, text: string): Promise<void> { await this.runtime.input(provider, id, text) }

  /**
   * Close native authorization and refresh availability without inference.
   * @param provider - Selected account.
   * @param id - Displayed login identity.
   * @returns Account observation after terminal cleanup.
   */
  @Remote('closeLogin')
  async closeLogin(provider: CliProvider, id: CliLoginId): Promise<CliAccountStatus> {
    await this.runtime.cancel(provider, id)
    this.accountValues.delete(provider)
    return this.refresh(provider)
  }

  /**
   * Request native quota only on explicit user action; Codex needs no model turn.
   * @param provider - Selected native account; Grok has no supported query.
   * @param signal - Remote caller cancellation.
   * @returns Native quota windows, or null when unavailable; unsupported commands reject.
   */
  @Remote('refreshQuota')
  async refreshQuota(provider: CliProvider, signal: AbortSignal): Promise<readonly CliQuotaWindow[] | null> {
    if (provider === 'grok-cli') throw new Error('Grok CLI has no supported headless quota query')
    if ((provider === 'antigravity-cli' && this.executing.has(provider)) || this.runtime.login(provider)?.status === 'running') throw new Error('Wait for active CLI work before querying quota')
    return this.runtime.run(async (controller) => {
      const binary = await this.binary(provider)
      if (provider === 'codex-cli') {
        const quota = await readCodexQuota(this.ctx, binary, homedir(), this.config, controller.signal)
        this.accountValues.set(provider, { ...this.accountValues.get(provider) ?? this.empty(provider),
          quota, quotaObservedAt: Date.now() })
        return quota
      }
      const cwd = join(this.config.runtimeRoot, provider, 'quota')
      await mkdir(cwd, { recursive: true })
      const name = await this.prepareAntigravity(binary, cwd, controller.signal)
      const result = await this.runtime.command([binary, '--agent', name, '--output-format', 'text', '-p=/usage'], cwd, controller.signal, this.config.accountTimeoutMs)
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || 'Native quota query failed; permissions were not broadened')
      const quota = parseQuota(result.stdout)
      this.accountValues.set(provider, { ...this.accountValues.get(provider) ?? this.empty(provider), quota, quotaObservedAt: Date.now() })
      return quota
    }, signal)
  }

  private async prepareAntigravity(binary: string, cwd: string, signal: AbortSignal): Promise<string> {
    const suffix = createHash('sha256').update(this.config.runtimeRoot + BRIDGE_INSTRUCTIONS).digest('hex').slice(0, 24)
    const name = 'dsh-bridge-' + suffix
    const definition = '---\nname: ' + name + '\ndescription: DSH structured response transport\ntools: [finish]\nmainAgent: true\nsubagent: false\ninheritMcp: false\ninheritCustomizations: false\ncommandExecutionPolicy: off\n---\n# System Prompt\n' + BRIDGE_INSTRUCTIONS + '\n'
    await writeFileAtomic(join(this.config.antigravityAgentRoot, name + '.md'), definition, { mode: 0o600, dirMode: 0o700 })
    // AGY 1.1.27 silently selects its default agent when workspace discovery misses a definition.
    const listed = await this.runtime.command([binary, 'agents'], cwd, signal, this.config.accountTimeoutMs)
    if (listed.exitCode !== 0 || !listed.stdout.split(/\r?\n/u).some(line => line.trim() === name)) {
      throw new Error('Antigravity did not discover the DSH agent; no model request was sent')
    }
    return name
  }

  private async execute(provider: CliProvider, input: AgentExecutionRequest): Promise<AgentExecutionResult> {
    if (this.loginStarts.has(provider) || this.runtime.login(provider)?.status === 'running') throw new Error('Close CLI login before starting an Agent')
    this.counts.set(provider, (this.counts.get(provider) ?? 0) + 1)
    this.executing.add(provider)
    try { return await this.runtime.run(controller => this.executeOwned(provider, input, controller.signal), input.request.signal) }
    finally {
      const count = this.counts.get(provider)
      assert(count !== undefined)
      const remaining = count - 1
      this.counts.set(provider, remaining)
      if (!remaining) this.executing.delete(provider)
    }
  }

  private async executeOwned(provider: CliProvider, input: AgentExecutionRequest, signal: AbortSignal): Promise<AgentExecutionResult> {
    const { request, agent } = input
    if (request.temperature !== undefined || request.stop !== undefined || request.maxTokens !== undefined || (provider !== 'codex-cli' && request.reasoningEffort !== undefined)) {
      throw new Error('This CLI route supports native model selection without generation parameter overrides')
    }
    for (const message of request.messages) for (const block of message.content) {
      if (block.type === 'image' || block.type === 'file') throw new Error('This CLI route currently accepts text and DSH tool results')
    }
    const binary = await this.binary(provider)
    const schema = outputSchema(request.tools ?? [])
    const signature = createHash('sha256').update(JSON.stringify([provider, binary, this.config.runtimeRoot, this.config.antigravityAgentRoot, request.model, request.reasoningEffort, request.system, request.tools, schema, BRIDGE_INSTRUCTIONS,
      provider === 'codex-cli' ? CODEX_RESTRICTIONS : null])).digest('hex')
    const events = agent.session.snapshotEvents()
    const checkpoint = events.findLast(event => event.type === 'cli-agent/checkpoint' && event.data.provider === provider)
    const lastPrompt = events.findLast(event => event.type === 'cli-agent/prompt' && event.data.provider === provider)
    const previous = checkpoint?.type === 'cli-agent/checkpoint' && lastPrompt && checkpoint.seq > lastPrompt.seq
      && checkpoint.data.ownerSessionId === agent.session.id && checkpoint.data.signature === signature
      && checkpoint.data.messageIds.every((id, index) => request.messages[index]?.id === id) ? checkpoint.data : undefined
    const messages = previous ? request.messages.slice(previous.messageIds.length) : request.messages
    const prompt = previous ? JSON.stringify({ messages })
      : BRIDGE_INSTRUCTIONS + '\n' + JSON.stringify({ system: request.system ?? '', tools: request.tools ?? [], messages })
    if (Buffer.byteLength(prompt) + Buffer.byteLength(schema) > this.config.inputBytes) throw new Error('CLI input exceeds configured byte limit')
    const owner = createHash('sha256').update(agent.session.id).digest('hex')
    const cwd = join(this.config.runtimeRoot, provider, owner)
    await mkdir(cwd, { recursive: true })
    const schemaFile = join(cwd, 'response-schema.json')
    const promptFile = join(cwd, 'request.txt')
    await writeFile(schemaFile, schema, 'utf8')
    await writeFile(promptFile, prompt, 'utf8')
    agent.session.append('cli-agent/prompt', { provider, prompt, schema, bootstrap: previous === undefined })
    let conversationId: string
    let raw: unknown
    let nativeUsage: Readonly<Record<string, number>>
    let costUsd: number | null = null
    let codexObservation: ReturnType<typeof codexUsage> | undefined
    if (provider === 'grok-cli') {
      const id = previous?.conversationId ?? randomUUID()
      const args = [binary, '--prompt-file', promptFile, '--output-format', 'json', '--model', request.model,
        '--tools', '', '--no-subagents', '--disable-web-search', '--deny', '*', '--permission-mode', 'dontAsk', '--max-turns', '1',
        '--system-prompt-override', BRIDGE_INSTRUCTIONS, '--json-schema', schema,
        ...(previous ? ['--resume', id] : ['--session-id', id])]
      const result = await this.runtime.command(args, cwd, signal, this.config.requestTimeoutMs)
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || 'Grok request failed')
      const parsed = grokResult.parse(JSON.parse(result.stdout))
      if (parsed.sessionId !== id) throw new Error('Grok resumed an unexpected conversation')
      if (parsed.stopReason && !['end_turn', 'stop', 'completed'].includes(parsed.stopReason)) throw new Error('Grok did not complete: ' + parsed.stopReason)
      conversationId = parsed.sessionId; raw = parsed.structured_output ?? parsed.text
      nativeUsage = parsed.usage ?? {}; costUsd = parsed.total_cost_usd ?? null
    } else if (provider === 'codex-cli') {
      const native = await runCodex(this.ctx, binary, cwd, this.config, signal, {
        model: request.model, ...(request.reasoningEffort ? { effort: request.reasoningEffort } : {}), prompt, schema,
        ...(previous ? { conversationId: previous.conversationId } : {}), timeoutMs: this.config.requestTimeoutMs,
      })
      conversationId = native.conversationId; raw = native.text
      codexObservation = codexUsage(request.model, native.usage, previous?.nativeUsage ?? {})
      nativeUsage = codexObservation.counters
    } else {
      const name = await this.prepareAntigravity(binary, cwd, signal)
      let final: wire.infer<typeof agyResult> | undefined
      let initialized = false
      const args = [binary, '--input-format', 'stream-json', '--output-format', 'stream-json',
        '--model', request.model, '--agent', name, '--disable-slash-commands', '--json-schema', schemaFile,
        '--print-timeout', String(Math.ceil(this.config.requestTimeoutMs / 1000)) + 's',
        ...previous ? ['--conversation', previous.conversationId] : []]
      const result = await this.runtime.command(args, cwd, signal, this.config.requestTimeoutMs,
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } }) + '\n',
        (line) => {
          const event = wire.object({ event: wire.string() }).passthrough().parse(JSON.parse(line))
          if (event.event === 'init') {
            const init = wire.object({ init: wire.object({ agent: wire.string() }) }).parse(event)
            // init.tools is the CLI-wide catalog even when a custom agent is selected.
            if (initialized || init.init.agent !== name) throw new Error('Antigravity initialized an unexpected agent')
            initialized = true
          } else if (event.event === 'step_update') {
            const step = wire.object({ step_update: wire.object({
              step_type: wire.string(), tool_name: wire.string().optional(),
            }) }).parse(event)
            if (step.step_update.step_type === 'subagent' || (step.step_update.step_type === 'tool' && step.step_update.tool_name !== 'finish')) throw new Error('Antigravity attempted a native tool outside DSH')
          } else if (event.event === 'result') {
            if (final) throw new Error('Antigravity returned duplicate results')
            final = agyResult.parse(event.result)
          }
        })
      if (result.exitCode !== 0 || !initialized || !final) throw new Error(result.stderr.trim() || 'Antigravity exited without an initialized result')
      if (final.status !== 'SUCCESS' || final.denied_actions?.length) throw new Error(final.error || 'Antigravity did not complete: ' + final.status)
      if (previous && final.conversation_id !== previous.conversationId) throw new Error('Antigravity resumed an unexpected conversation')
      conversationId = final.conversation_id; raw = final.structured_output ?? final.response; nativeUsage = final.usage ?? {}
    }
    const response = parseResponse(raw, request.tools ?? [])
    const stream = input.startMessage()
    const blocks: ContentBlock[] = [
      ...response.text ? [{ type: 'text' as const, text: response.text }] : [],
      ...response.calls.map(call => ({ type: 'tool-call' as const, id: ToolCallId(randomUUID()), name: call.name, arguments: call.arguments })),
    ]
    blocks.forEach((block, index) => {
      if (block.type !== 'text' && block.type !== 'tool-call') return
      stream.push({ type: 'block-start', index, blockType: block.type })
      stream.push({ type: 'block-end', index, block })
    })
    stream.push({ type: 'finish', reason: { kind: response.calls.length ? 'tool-calls' : 'stop' } })
    const assistant = stream.complete()
    const usage = codexObservation?.usage ?? usageSample(provider, request.model, nativeUsage, previous?.nativeUsage ?? {}, costUsd)
    agent.session.append('cli-agent/usage', usage)
    agent.session.append('cli-agent/checkpoint', { provider, conversationId: conversationId as CliConversationId,
      ownerSessionId: agent.session.id, signature,
      messageIds: [...request.messages.map(message => message.id), assistant.id], nativeUsage })
    this.accountValues.set(provider, { ...this.accountValues.get(provider) ?? this.empty(provider),
      installed: true, authenticated: true, error: null })
    const calls = assistant.content.filter(block => block.type === 'tool-call')
    if (!calls.length) return { kind: 'completed' }
    const { concluded } = await input.executeTools(calls)
    return concluded ? { kind: 'completed' } : null
  }
}
export default CliAgents
