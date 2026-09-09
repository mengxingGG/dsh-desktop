import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import ClaudeCodeEngine, { Config } from '../src/engine.ts'
import { startMessagesFixture, type MessagesBehavior } from './messages-fixture.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function harness(behavior: MessagesBehavior) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-claude-engine-'))
  cleanup.push(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  const cwd = join(root, 'workspace')
  const configDir = join(root, 'claude')
  await Promise.all([mkdir(cwd), mkdir(configDir)])
  const server = await startMessagesFixture(behavior)
  cleanup.push(() => server.close())
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(AgentLoop, { agents: [] })
  const engine = ctx.plugin(ClaudeCodeEngine, Config({
    configDir,
    accountTimeoutMs: 15_000, accountOutputBytes: 65_536, disposeGraceMs: 1000, loginTimeoutMs: 30_000, maxTurns: 8,
    env: {
      ANTHROPIC_API_KEY: 'dsh-local-fixture-key', ANTHROPIC_BASE_URL: server.baseUrl,
      HOME: root, XDG_CONFIG_HOME: root,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
      DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', NO_PROXY: '127.0.0.1,localhost',
    },
  }))
  await engine
  const errors: unknown[] = []
  ctx.on('agent/error', ({ error }) => { errors.push(error) })
  const agent = await ctx.agentLoop.create(SessionId('claude-runtime'), {
    provider: 'claude-code', model: 'claude-sonnet-5', reasoningEffort: ReasoningEffortId('low'),
  }, { cwd })
  return { ctx, agent, server, errors, engine, cwd }
}

function prompt(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

// Each case starts multiple native CLI processes and awaits whole-range cleanup.
describe('Claude execution through the real SDK and native CLI', { timeout: 30_000 }, () => {
  it('forks DSH history into a distinct native conversation', async () => {
    const { ctx, agent, errors, cwd } = await harness({ kind: 'complete', text: 'parent answer' })
    agent.followup(prompt('parent input'))
    await agent.whenIdle()
    const seed = agent.session.snapshotEvents()
    const child = await ctx.agents.create({ sessionId: SessionId('claude-fork'), seed,
      inheritedEventCount: SessionLogOffset(seed.length), meta: { cwd, isSeeded: true, parentSession: agent.id },
      agentOptions: { provider: 'claude-code', model: 'claude-sonnet-5' } })
    child.agent.followup(prompt('fork input'))
    await child.agent.whenIdle()
    expect(errors).toEqual([])
    const first = seed.find(event => event.type === 'claude-code/binding')
    const last = child.agent.session.ownEvents().find(event => event.type === 'claude-code/binding')
    expect(first?.type === 'claude-code/binding' && last?.type === 'claude-code/binding' && first.data.sessionId !== last.data.sessionId).toBe(true)
    expect(child.agent.session.ownEvents().find(event => event.type === 'claude-code/prompt')?.data).toMatchObject({ bootstrap: true })
    await child.dispose()
  })

  it('cancels and drains a live model request when its plugin unloads', async () => {
    const { agent, server, engine } = await harness({ kind: 'hold' })
    agent.followup(prompt('wait for cancellation'))
    await server.requestStarted
    await engine.dispose()
    await agent.whenIdle()
    const end = agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')
    expect(end?.data).toMatchObject({ reason: { kind: 'aborted' } })
  })

  it('honors a DSH permission denial before executing the MCP tool', async () => {
    const { ctx, agent, errors, server } = await harness({ kind: 'tool-use', toolName: 'mcp__dsh__restricted', input: {}, finalText: 'denied' })
    let called = false
    ctx.tools.register(defineContentToolFixture({ name: 'restricted', description: 'Restricted', parameters: {},
      execute: async () => { called = true; return [{ type: 'text', text: 'must not run' }] } }))
    ctx.on('tools/pre-execute', async () => ({ kind: 'deny', reason: 'fixture permission denied' }))
    agent.followup(prompt('try restricted tool'))
    await agent.whenIdle()
    expect(errors).toEqual([])
    expect(called).toBe(false)
    expect(JSON.stringify(server.requests.at(-1)?.body)).toContain('fixture permission denied')
  })
  it('resumes the same native conversation on a second DSH turn', async () => {
    const { agent, server, errors } = await harness({ kind: 'complete', text: 'fixture answer' })
    agent.followup(prompt('first turn nonce'))
    await agent.whenIdle()
    expect(errors).toEqual([])
    agent.followup(prompt('second turn nonce'))
    await agent.whenIdle()
    expect(errors).toEqual([])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'claude-code/binding')).toHaveLength(1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(2)
    const last = JSON.stringify(server.requests.at(-1)?.body.messages)
    expect(last).toContain('first turn nonce')
    expect(last).toContain('fixture answer')
    expect(last).toContain('second turn nonce')
    expect(server.requests.every(request => request.body.model === 'claude-sonnet-5')).toBe(true)
  })

  it('executes an MCP callback through DSH and persists its tool result', async () => {
    const { ctx, agent, server, errors } = await harness({ kind: 'tool-use', toolName: 'mcp__dsh__echo',
      input: { text: 'bridge nonce' }, finalText: 'tool complete' })
    ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'Echo text',
      parameters: { text: { type: 'string', required: true } }, execute: async ({ text }) => [{ type: 'text', text }] }))
    agent.followup(prompt('Use the echo tool'))
    await agent.whenIdle()
    expect(errors).toEqual([])
    const results = agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    expect(JSON.stringify(results[0])).toContain('bridge nonce')
    expect(JSON.stringify(server.requests.at(-1)?.body.messages)).toContain('bridge nonce')
  })
})
