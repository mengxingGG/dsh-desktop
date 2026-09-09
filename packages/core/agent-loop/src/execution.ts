/** Loop-owned transcript and tool execution for external agent runtimes. */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentExecutionRequest, AgentExecutionResult, AgentExecutor } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { AssistantStreamAttempt } from './assistant-stream.ts'
import { executeToolCalls } from './tool-calls.ts'

/**
 * Run an external provider with the same transcript settlement and tools as native steps.
 * @param ctx - loop context carrying the initiating Agent and tool services.
 * @param executor - selected external runtime.
 * @param input - admitted request and owning Agent.
 * @param newAttempt - loop-owned allocator shared with native assistant attempts.
 * @returns the provider's step result after any unfinished assistant attempt settles.
 */
export async function executeExternalStep(
  ctx: Context,
  executor: AgentExecutor,
  input: Pick<AgentExecutionRequest, 'agent' | 'request' | 'turn' | 'step'>,
  newAttempt: () => AssistantStreamAttempt,
): Promise<AgentExecutionResult> {
  const { agent, request, turn, step } = input
  const { session } = agent
  let live: AssistantStreamAttempt | undefined
  let active = true
  const toolAbort = new AbortController()
  const toolSignal = request.signal === undefined ? toolAbort.signal : AbortSignal.any([request.signal, toolAbort.signal])
  const toolWork = new Set<Promise<unknown>>()
  let toolQueue: Promise<unknown> = Promise.resolve()
  const requireActive = (): void => {
    if (!active) throw new Error('agent execution has already settled')
    request.signal?.throwIfAborted()
  }
  try {
    ctx.emit('agents/execution-request', request)
    const result = await executor.execute({
      ...input,
      startMessage: () => {
        requireActive()
        if (live !== undefined && !live.ended) throw new Error('preceding assistant message is not settled')
        const attempt = newAttempt()
        live = attempt
        attempt.start()
        return {
          push: (chunk) => {
            requireActive()
            if (attempt.ended) throw new Error('assistant message is already settled')
            attempt.push(chunk)
          },
          complete: () => {
            requireActive()
            if (attempt.ended) throw new Error('assistant message is already settled')
            const message = createAssistantMessage({
              content: attempt.blocks(),
              source: { provider: request.provider, model: request.model },
            })
            attempt.settle('assistant/message', () => session.append('assistant/message', {
              turn, step, message, stream: attempt.stream,
              ...attempt.usage === undefined ? {} : { usage: attempt.usage },
            }, { surfaceOp: 'append' }).seq)
            return message
          },
        }
      },
      executeTools: (calls) => {
        requireActive()
        if (live !== undefined && !live.ended) throw new Error('assistant message must commit before tools execute')
        // Separate CLI callbacks cannot bypass an exclusive DSH scheduling barrier.
        const work = toolQueue.then(async () => {
          const before = session.snapshotEvents().length
          const outcome = await executeToolCalls(ctx, turn, step, calls, toolSignal, (context) =>{  agent.inject(context) })
          const results = session.snapshotEvents().slice(before).flatMap(event =>
            event.type === 'tool/result' && calls.some(call => call.id === event.data.message.source.callId)
              ? [event.data.message] : [])
          return { ...outcome, results }
        })
        toolQueue = work
        toolWork.add(work)
        void work.then(() => toolWork.delete(work), () => toolWork.delete(work))
        return work
      },
    })
    if (live !== undefined && !live.ended) throw new Error('agent executor returned with an unfinished assistant message')
    if (toolWork.size > 0) throw new Error('agent executor returned before its tools settled')
    return result
  } finally {
    active = false
    toolAbort.abort()
    await Promise.allSettled(toolWork)
    if (live !== undefined && !live.ended) {
      const attempt = live
      const content = attempt.interruptedBlocks()
      if (request.signal?.aborted && content.length > 0) {
        const message = createAssistantMessage({ content, source: { provider: request.provider, model: request.model } })
        attempt.settle('assistant/message', () => session.append('assistant/message', {
          turn, step, message, interrupted: true, stream: attempt.stream,
          ...attempt.usage === undefined ? {} : { usage: attempt.usage },
        }, { surfaceOp: 'append' }).seq)
      } else {
        attempt.settle('assistant/attempt', () => session.append('assistant/attempt', {
          turn, step, stream: attempt.stream,
        }).seq)
      }
    }
  }
}
