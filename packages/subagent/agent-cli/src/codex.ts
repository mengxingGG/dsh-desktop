/** Private Codex app-server operations over the shared managed subprocess and JSON-RPC transport. */
import type { Context } from '@deepseek-ai/cordis'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import { Transform } from 'node:stream'
import assert from 'node:assert/strict'
import { z } from 'zod'
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import type { RuntimeConfig } from './runtime.ts'
import { codexModelPage, codexModels, codexQuota, codexTokenUsage } from './codex-protocol.ts'
import { BRIDGE_INSTRUCTIONS } from './protocol.ts'
import type { CliConversationId, CliQuotaWindow } from './types.ts'

/** Fixed native execution restrictions; deployment settings cannot broaden DSH tool access. */
export const CODEX_RESTRICTIONS: Readonly<Record<string, unknown>> = {
  'model_provider': 'openai', 'approval_policy': 'never', 'sandbox_mode': 'read-only', 'web_search': 'disabled',
  'project_doc_max_bytes': 0, 'include_environment_context': false, 'include_apps_instructions': false,
  'include_collaboration_mode_instructions': false, 'memories.generate_memories': false, 'memories.use_memories': false,
  'agents.enabled': false, 'tools.update_plan.enabled': false,
  ...Object.fromEntries(['shell_tool', 'unified_exec', 'apply_patch_freeform', 'apps', 'connectors', 'plugins', 'remote_plugin',
    'multi_agent', 'multi_agent_v2', 'collab', 'code_mode', 'code_mode_only', 'js_repl', 'computer_use', 'browser_use',
    'image_generation', 'view_image', 'memories', 'memory_tool', 'goals', 'sleep_tool', 'hooks', 'codex_hooks', 'plugin_hooks',
    'tool_search', 'tool_suggest', 'skill_search', 'skill_mcp_dependency_install', 'request_permissions', 'request_permissions_tool',
    'shell_snapshot', 'workspace_dependencies', 'current_time_reminder'].map(key => ['features.' + key, false])),
  'features.skip_host_skill_discovery': true,
}

type ObjectValue = Record<string, unknown>
const object = z.record(z.string(), z.unknown())
const threadResponse = z.object({ thread: z.object({ id: z.string().min(1) }), model: z.string(), modelProvider: z.string(),
  approvalPolicy: z.literal('never'), sandbox: z.object({ type: z.literal('readOnly'), networkAccess: z.literal(false).optional() }) })
const completedTurn = z.object({ id: z.string().min(1), status: z.string(), error: z.object({ message: z.string() }).nullish() })

class Connection {
  private readonly failed = Promise.withResolvers<never>()
  private readonly wire: JsonRpcLineTransport
  private readonly child
  private readonly input: Transform
  private readonly timeout: ReturnType<typeof setTimeout>
  private closing = false
  private listener: (method: string, params: ObjectValue) => void = () => {}
  private readonly abort: () => void

  constructor(ctx: Context, binary: string, cwd: string, config: RuntimeConfig, private readonly signal: AbortSignal, timeoutMs: number) {
    signal.throwIfAborted()
    this.child = ctx.subprocess.spawn({ argv: [binary, 'app-server', '--listen', 'stdio://',
      ...Object.entries(CODEX_RESTRICTIONS).flatMap(([key, value]) => ['-c', key + '=' + JSON.stringify(value)])],
    cwd, env: config.env, signal, graceMs: config.disposeGraceMs,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: config.outputBytes } } })
    let bytes = 0
    this.input = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      callback(bytes > config.outputBytes ? new Error('Codex protocol output exceeds the configured byte limit') : null, chunk)
    } })
    assert(this.child.stdin && this.child.stdout)
    this.wire = new JsonRpcLineTransport(this.input, this.child.stdin)
    void this.failed.promise.catch(() => {})
    const fail = (error: Error) => { if (!this.closing) { this.failed.reject(error); this.wire.close(); this.child.terminate() } }
    this.input.on('error', fail)
    this.child.stdout.on('error', fail)
    this.child.stdin.on('error', fail)
    this.child.stdout.on('end', () => fail(new Error('Codex protocol closed before the operation completed')))
    void this.child.done.then(() => fail(new Error('Codex app-server exited')), error => fail(error instanceof Error ? error : new Error(String(error))))
    this.abort = () => fail(signal.reason instanceof Error ? signal.reason : new Error('Codex operation cancelled'))
    signal.addEventListener('abort', this.abort, { once: true })
    this.timeout = setTimeout(() => fail(new Error('Codex operation timed out')), timeoutMs)
    this.wire.onNotification((method, params) => {
      try { this.listener(method, params) }
      catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
    })
    this.wire.onRequest(async (method) => {
      // Native tools have no approval route; all project effects must return through the DSH envelope.
      if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') return { decision: 'decline' }
      if (method === 'item/permissions/requestApproval') return { permissions: {}, scope: 'turn' }
      throw new Error('Codex requested an unsupported native operation: ' + method)
    })
    this.wire.start()
    this.child.stdout.pipe(this.input)
    if (signal.aborted) this.abort()
  }

  async initialize(): Promise<void> {
    await this.request('initialize', { clientInfo: { name: 'dsh-cli-adapter', title: 'DSH CLI adapter', version: '1.0.0' },
      capabilities: { experimentalApi: true, requestAttestation: false } })
    this.wire.notify('initialized')
    await this.wait(this.wire.flush())
  }
  request(method: string, params: object): Promise<unknown> { return this.wait(this.wire.request(method, params, this.signal)) }
  wait<T>(work: Promise<T>): Promise<T> { return Promise.race([work, this.failed.promise]) }
  observe(listener: (method: string, params: ObjectValue) => void): void { this.listener = listener }
  async close(): Promise<void> {
    this.closing = true
    clearTimeout(this.timeout)
    this.signal.removeEventListener('abort', this.abort)
    this.wire.close()
    this.child.terminate()
    await this.child.waitForExit()
    assert(this.child.stdout)
    this.child.stdout.unpipe(this.input)
    this.input.destroy()
  }
}

async function connected<T>(ctx: Context, binary: string, cwd: string, config: RuntimeConfig, signal: AbortSignal,
  timeoutMs: number, work: (connection: Connection) => Promise<T>): Promise<T> {
  const connection = new Connection(ctx, binary, cwd, config, signal, timeoutMs)
  try { await connection.initialize(); return await work(connection) }
  finally { await connection.close() }
}

/**
 * Read the native account and paginated model directory without a model turn.
 * @param ctx - Managed subprocess owner.
 * @param binary - Resolved native Codex executable.
 * @param cwd - Account operation working directory.
 * @param config - Account deadline and process bounds.
 * @param signal - Operation cancellation.
 * @returns Authentication presence and models, without account identifiers or tokens.
 */
export function inspectCodex(ctx: Context, binary: string, cwd: string, config: RuntimeConfig,
  signal: AbortSignal): Promise<{ authenticated: boolean; models: LlmResolvedModelInfo[] }> {
  return connected(ctx, binary, cwd, config, signal, config.accountTimeoutMs, async (connection) => {
    const account = z.object({ account: object.nullish() }).parse(await connection.request('account/read', { refreshToken: false }))
    const models = new Map<string, LlmResolvedModelInfo>(), cursors = new Set<string>()
    let cursor: string | null | undefined
    do {
      const page = codexModelPage.parse(await connection.request('model/list', { includeHidden: false, ...(cursor ? { cursor } : {}) }))
      for (const model of codexModels(page)) models.set(model.id, model)
      cursor = page.nextCursor
      if (cursor && cursors.has(cursor)) throw new Error('Codex model directory repeated its pagination cursor')
      if (cursor) cursors.add(cursor)
    } while (cursor)
    return { authenticated: account.account != null, models: [...models.values()] }
  })
}

/**
 * Read native quota without creating a thread or consuming reset credits.
 * @param ctx - Managed subprocess owner.
 * @param binary - Resolved native Codex executable.
 * @param cwd - Account operation working directory.
 * @param config - Account deadline and process bounds.
 * @param signal - Operation cancellation.
 * @returns Actual quota windows, or null when the native account has none.
 */
export function readCodexQuota(ctx: Context, binary: string, cwd: string, config: RuntimeConfig,
  signal: AbortSignal): Promise<CliQuotaWindow[] | null> {
  return connected(ctx, binary, cwd, config, signal, config.accountTimeoutMs,
    async connection => codexQuota(await connection.request('account/rateLimits/read', {})))
}

/** One DSH step projected into a durable native Codex thread. */
export interface CodexInvocation {
  readonly model: string
  readonly effort?: string
  readonly prompt: string
  readonly schema: string
  readonly conversationId?: CliConversationId
  readonly timeoutMs: number
}

/**
 * Complete one structured native response; the caller owns DSH tool dispatch.
 * @param ctx - Managed subprocess owner.
 * @param binary - Resolved native Codex executable.
 * @param cwd - Private protocol workspace, never the user's project.
 * @param config - Process bounds and explicit environment.
 * @param signal - Agent cancellation.
 * @param invocation - Exact logged prompt, model, schema and eligible continuation.
 * @returns Completed text, thread identity, and native token counters.
 */
export function runCodex(ctx: Context, binary: string, cwd: string, config: RuntimeConfig,
  signal: AbortSignal, invocation: CodexInvocation): Promise<{ conversationId: string; text: string; usage: unknown }> {
  return connected(ctx, binary, cwd, config, signal, invocation.timeoutMs, async (connection) => {
    const nativeConfig = z.object({ config: object }).parse(await connection.request('config/read', { includeLayers: false, cwd })).config
    const overrides: ObjectValue = { ...CODEX_RESTRICTIONS }
    // Empty TOML tables merge with user settings, so disable each inherited MCP entry explicitly.
    for (const name of Object.keys(object.parse(nativeConfig.mcp_servers ?? {}))) overrides['mcp_servers.' + JSON.stringify(name) + '.enabled'] = false
    const params = { cwd, model: invocation.model, modelProvider: 'openai', approvalPolicy: 'never', sandbox: 'read-only',
      baseInstructions: BRIDGE_INSTRUCTIONS, developerInstructions: '', config: overrides }
    const thread = threadResponse.parse(await connection.request(invocation.conversationId ? 'thread/resume' : 'thread/start',
      invocation.conversationId ? { ...params, threadId: invocation.conversationId, excludeTurns: true }
        : { ...params, ephemeral: false, serviceName: 'deepseek-harness', allowProviderModelFallback: false, environments: [], selectedCapabilityRoots: [] }))
    if (thread.model !== invocation.model || thread.modelProvider !== 'openai' || (invocation.conversationId && thread.thread.id !== invocation.conversationId)) {
      throw new Error('Codex returned an unexpected model, provider or conversation')
    }
    const terminal = Promise.withResolvers<z.infer<typeof completedTurn>>()
    let text = '', usage: unknown = null, observedTurn: string | undefined
    connection.observe((method, params) => {
      if (params.threadId !== thread.thread.id) return
      if (method === 'turn/completed') {
        const turn = completedTurn.parse(params.turn)
        if (observedTurn && turn.id !== observedTurn) throw new Error('Codex completed an unexpected turn')
        observedTurn = turn.id
        terminal.resolve(turn)
      } else if (method === 'thread/tokenUsage/updated') {
        usage = codexTokenUsage.parse(params.tokenUsage)
      } else if (method === 'item/completed' || method === 'item/started') {
        const item = object.parse(params.item)
        const type = z.string().parse(item.type)
        if (!['userMessage', 'agentMessage', 'reasoning', 'contextCompaction'].includes(type)) {
          throw new Error('Codex attempted a native tool outside the DSH execution route: ' + type)
        }
        if (method === 'item/completed' && type === 'agentMessage' && (item.phase == null || item.phase === 'final_answer')) text = z.string().parse(item.text)
      }
    })
    const start = z.object({ turn: completedTurn }).parse(await connection.request('turn/start', {
      threadId: thread.thread.id, input: [{ type: 'text', text: invocation.prompt, text_elements: [] }],
      model: invocation.model, ...(invocation.effort ? { effort: invocation.effort } : {}),
      approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: false }, environments: [], outputSchema: JSON.parse(invocation.schema),
    }))
    if (observedTurn && observedTurn !== start.turn.id) throw new Error('Codex returned an unexpected turn identity')
    observedTurn = start.turn.id
    const ended = await connection.wait(terminal.promise)
    if (ended.status !== 'completed') throw new Error(ended.error?.message ?? 'Codex turn ended: ' + ended.status)
    if (!text) throw new Error('Codex completed without a structured response')
    return { conversationId: thread.thread.id, text, usage }
  })
}
