/** Native per-request usage observations and their durable Session projection. */

import { z } from 'zod'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { ClaudeUsageSnapshot } from './engine-usage-types.ts'
import type {} from './engine-events.ts'

const count = z.number().int().nonnegative()
const nativeUsage = z.object({
  input_tokens: count.nullish(), output_tokens: count.nullish(),
  cache_read_input_tokens: count.nullish(), cache_creation_input_tokens: count.nullish(),
})
const usageSchema = z.object({
  model: z.string(), inputTokens: count.nullable(), outputTokens: count.nullable(),
  cacheReadTokens: count.nullable(), cacheWriteTokens: count.nullable(),
  contextTokens: count.nullable(), contextWindow: z.number().int().positive().nullable(), updatedAt: count,
}).strict().nullable()

/** Pure last-observation projection shared by reopened and live conversations. */
export const claudeUsageProjection = {
  key: 'claudeUsage', stateVersion: 1, stateSchema: usageSchema, init: () => null,
  apply: (state, event) => event.type === 'claude-code/usage' ? event.data : state,
  wire: { viewSchema: usageSchema, view: state => state },
} satisfies ProjectionDefinition<'claudeUsage'>

/** Folds partial usage for one native message without summing repeated SDK block messages. */
export class ClaudeUsageCollector {
  private messageId: string | undefined
  private value: ClaudeUsageSnapshot

  constructor(private readonly requestedModel: string, previous: ClaudeUsageSnapshot | null = null) {
    this.value = this.empty(requestedModel, previous?.model === requestedModel ? previous.contextWindow : null)
  }

  private empty(model: string, contextWindow: number | null): ClaudeUsageSnapshot {
    return { model, contextWindow, contextTokens: null, inputTokens: null, outputTokens: null,
      cacheReadTokens: null, cacheWriteTokens: null, updatedAt: Date.now() }
  }

  private sample(raw: unknown, id?: string, model?: string): ClaudeUsageSnapshot {
    if (id !== undefined && id !== this.messageId) {
      this.messageId = id
      this.value = this.empty(model ?? this.requestedModel,
        model === undefined || model === this.value.model ? this.value.contextWindow : null)
    }
    const usage = nativeUsage.parse(raw)
    const inputTokens = usage.input_tokens ?? this.value.inputTokens
    const outputTokens = usage.output_tokens ?? this.value.outputTokens
    const cacheReadTokens = usage.cache_read_input_tokens ?? this.value.cacheReadTokens
    const cacheWriteTokens = usage.cache_creation_input_tokens ?? this.value.cacheWriteTokens
    this.value = { ...this.value, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
      contextTokens: inputTokens === null || cacheReadTokens === null || cacheWriteTokens === null
        ? null : inputTokens + cacheReadTokens + cacheWriteTokens,
      updatedAt: Date.now() }
    return this.value
  }

  /**
   * Observe a main-loop request or native capacity; compaction invalidates the preceding request size.
   * @param message - SDK-decoded native event.
   * @returns a complete changed observation, or undefined for unrelated events.
   */
  accept(message: SDKMessage): ClaudeUsageSnapshot | undefined {
    if (message.type === 'stream_event' && message.parent_tool_use_id === null) {
      if (message.event.type === 'message_start') {
        const initial = message.event.message
        return this.sample(initial.usage, initial.id, initial.model)
      }
      if (message.event.type === 'message_delta') return this.sample(message.event.usage)
    }
    if (message.type === 'assistant' && message.parent_tool_use_id === null) {
      return this.sample(message.message.usage, message.message.id, message.message.model)
    }
    if (message.type === 'system' && message.subtype === 'compact_boundary') {
      this.messageId = undefined
      this.value = this.empty(this.value.model, this.value.contextWindow)
      return this.value
    }
    if (message.type === 'result') {
      const capacity = message.modelUsage[this.value.model]
        ?? Object.values(message.modelUsage).find(value => value.canonicalModel === this.value.model)
      if (capacity !== undefined) {
        this.value = { ...this.value,
          contextWindow: count.parse(capacity.contextWindow) || null, updatedAt: Date.now() }
        return this.value
      }
    }
    return undefined
  }
}
