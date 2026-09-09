import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type AgentExecutor, type AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function harness(executor: AgentExecutor) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.agents.registerExecutor(executor)
  const errors: unknown[] = []
  ctx.on('agent/error', ({ error }) => { errors.push(error) })
  const agent = await ctx.agentLoop.create(SessionId('external'), { provider: executor.id, model: 'test-model' })
  return { ctx, agent, errors }
}

function prompt(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

describe('external agent execution', () => {
  it('retains pre-step policy, recorded input, live output and follow-up history', async () => {
    const inputs: unknown[] = []
    const { ctx, agent, errors } = await harness({
      id: 'external', name: 'External', models: async () => [{ provider: 'external', id: 'test-model', name: 'Test' }],
      execute: async (input) => {
        inputs.push(input.request.messages)
        expect(Object.isFrozen(input.request)).toBe(true)
        expect(input.agent.session.requestHeader()?.config.model).toBe('test-model')
        const stream = input.startMessage()
        for (const chunk of textResponse('external answer')) stream.push(chunk)
        stream.complete()
        return { kind: 'completed' }
      },
    })
    const native = new MockAdapter([textResponse('must not run')])
    ctx.llm.registerAdapter(['mock'], native)
    const frames: AssistantStreamFrame[] = []
    ctx.on('agent/assistant-stream', ({ frame }) => { frames.push(frame) })
    let admit = false
    ctx.on('agent/pre-step', (_payload, next) => admit ? next() : Promise.resolve({ kind: 'reject' }))
    agent.followup(prompt('rejected'))
    await agent.whenIdle()
    expect(inputs).toHaveLength(0)
    admit = true
    agent.followup(prompt('first'))
    await agent.whenIdle()
    agent.followup(prompt('second'))
    await agent.whenIdle()
    expect(inputs).toHaveLength(2)
    expect(JSON.stringify(inputs[1])).toContain('external answer')
    expect(native.requests).toHaveLength(0)
    expect(frames.filter(frame => frame.type === 'start')).toHaveLength(2)
    expect(frames.filter(frame => frame.type === 'end')).toHaveLength(2)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(2)
    expect(errors).toEqual([])
  })

  it('executes tools through DSH guards and records the denied result', async () => {
    const { ctx, agent, errors } = await harness({
      id: 'external', name: 'External', models: async () => [{ provider: 'external', id: 'test-model', name: 'Test' }],
      execute: async (input) => {
        const stream = input.startMessage()
        for (const chunk of toolCallResponse('external-tool', 'missing_tool', {})) stream.push(chunk)
        const message = stream.complete()
        const result = await input.executeTools(message.content.filter(block => block.type === 'tool-call'))
        expect(result.results).toHaveLength(1)
        expect(result.results[0]?.content[0].isError).toBe(true)
        const answer = input.startMessage()
        for (const chunk of textResponse('tool denied')) answer.push(chunk)
        answer.complete()
        return { kind: 'completed' }
      },
    })
    agent.followup(prompt('try tool'))
    await agent.whenIdle()
    expect(agent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(ctx.agents.executor('external')).toBeDefined()
    expect(errors).toEqual([])
  })

  it('unregisters providers when their plugin unloads and rejects duplicates', async () => {
    const executor: AgentExecutor = {
      id: 'external', name: 'External', models: async () => [{ provider: 'external', id: 'test-model', name: 'Test' }], execute: async () => ({ kind: 'completed' }),
    }
    const { ctx } = await harness(executor)
    expect(() => ctx.agents.registerExecutor(executor)).toThrow('already registered')
    const fiber = ctx.plugin(Object.assign((scope: Context) => {
      scope.agents.registerExecutor({ ...executor, id: 'owned' })
    }, { inject: ['agents'] }))
    await fiber
    expect(ctx.agents.executor('owned')).toBeDefined()
    await fiber.dispose()
    expect(ctx.agents.executor('owned')).toBeUndefined()
    expect(ctx.agents.listExecutors().map(item => item.id)).toEqual(['external'])
    const observer = ctx.on('agents/executors-updated', () => { throw Object.assign(new Error('invalid catalog'), { code: 'INVARIANT' }) })
    expect(() => ctx.agents.registerExecutor({ ...executor, id: 'rejected' })).toThrow('invalid catalog')
    expect(ctx.agents.executor('rejected')).toBeUndefined()
    observer()
  })
})
