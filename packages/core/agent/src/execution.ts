/** External execution providers that share the Agent's durable lifecycle. */

import type { AssistantMessage, GenerateOptions, LlmCallConfig, LlmResolvedModelInfo, StreamChunk, ToolCallBlock, ToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { TurnEndReason } from '@deepseek-ai/dsh-session'
import type { Agent } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A frozen, recorded request is entering an external Agent executor.
     * @mode emit
     * @param request - exact request whose header and messages are committed in its Session.
     */
    'agents/execution-request'(request: GenerateOptions): void
  }
}

/** A completed execution, or a request to enter another DSH step. */
export type AgentExecutionResult = Extract<TurnEndReason, { kind: 'completed' | 'max-tokens' }> | null

/** One live assistant message whose compact stream is committed by the loop. */
export interface AgentExecutionStream {
  /**
   * Publish an ordered transient chunk and retain it for durable settlement.
   * @param chunk - provider-normalized assistant stream chunk.
   */
  push(chunk: StreamChunk): void
  /**
   * Commit the complete assistant message before tools can execute.
   * @returns the exact committed message, including tool call identities.
   */
  complete(): AssistantMessage
}

/** One admitted step whose user input and request header are already committed. */
export interface AgentExecutionRequest {
  readonly agent: Agent
  readonly turn: number
  readonly step: number
  /** Frozen input reconstructed from the Session, including its live abort signal. */
  readonly request: GenerateOptions
  /**
   * Begin one assistant message; a preceding message must already be settled.
   * @returns a loop-owned live and durable stream sink.
   */
  startMessage(): AgentExecutionStream
  /**
   * Execute committed calls through DSH scheduling, permissions, and result logging.
   * @param calls - tool calls from a completed assistant message.
   * @returns committed results and whether a tool concludes this turn.
   */
  executeTools(calls: ToolCallBlock[]): Promise<{ results: ToolResultMessage[]; concluded: boolean }>
}

/**
 * A CLI or other agent runtime that owns model/tool iteration inside one DSH step.
 * Providers commit assistant streams and tool observations to the supplied Session,
 * enforce its scoped tool permissions, and drain owned work before settling.
 */
export interface AgentExecutor {
  /** Route shared by session model selections and Crew role preferences. */
  readonly id: string
  readonly name: string
  /**
   * Discover models without starting an inference request.
   * @returns models supported by this installed runtime and account.
   */
  models(): Promise<readonly LlmResolvedModelInfo[]>
  /**
   * Execute already admitted input under the request's cancellation signal.
   * @param input - owning Agent, step identity, and recorded request.
   * @returns completion or another-step decision after process and callback quiescence.
   */
  execute(input: AgentExecutionRequest): Promise<AgentExecutionResult>
}

/**
 * Resolve an external runtime selection against its current model directory.
 * @param executor - registered owner of the requested provider route.
 * @param config - requested model and optional reasoning effort.
 * @returns the accepted configuration with the model's declared default effort.
 */
export async function resolveExecutionConfig(executor: AgentExecutor, config: LlmCallConfig): Promise<LlmCallConfig> {
  const model = (await executor.models()).find(model => model.id === config.model)
  if (model === undefined) throw new Error(`${executor.name} does not offer model "${config.model}"`)
  const effort = config.reasoningEffort ?? model.reasoning?.defaultEffort
  if (effort !== undefined && !model.reasoning?.efforts.some(value => value.id === effort)) {
    throw new Error(`${executor.name} model "${model.id}" does not offer reasoning effort "${effort}"`)
  }
  return { ...config, ...effort === undefined ? {} : { reasoningEffort: effort } }
}
