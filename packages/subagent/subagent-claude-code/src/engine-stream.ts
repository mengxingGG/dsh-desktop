/** Claude SDK content-block streaming projected into loop-owned assistant records. */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentExecutionRequest, AgentExecutionStream } from '@deepseek-ai/dsh-agent'
import { ToolCallId, type ContentBlock, type ToolCallBlock } from '@deepseek-ai/dsh-llm'

/** MCP names encode the DSH server; persisted DSH calls retain their original tool names. */
const TOOL_PREFIX = 'mcp__dsh__'

/**
 * Resolve a Claude tool name to the exact scoped DSH tool name.
 * @param name - name received from the external CLI.
 * @returns the DSH name; native or foreign tools are rejected.
 */
export function dshToolName(name: string): string {
  if (!name.startsWith(TOOL_PREFIX)) throw new Error(`Claude attempted a tool outside the DSH composition: ${name}`)
  return name.slice(TOOL_PREFIX.length)
}

/** One completed CLI block, retaining its external call identity. */
function contentBlock(block: Extract<SDKMessage, { type: 'assistant' }>['message']['content'][number]): Extract<ContentBlock, { type: 'text' | 'reasoning' | 'tool-call' }> | undefined {
  switch (block.type) {
    case 'text': return { type: 'text', text: block.text }
    case 'thinking': return { type: 'reasoning', text: block.thinking }
    case 'tool_use': return {
      type: 'tool-call', id: ToolCallId(block.id), name: dshToolName(block.name), arguments: JSON.stringify(block.input),
    }
    default:
      // Redacted/provider-private blocks have no public text to display or execute.
      return undefined
  }
}

/**
 * Settles each SDK assistant block before its MCP call can run. The CLI emits
 * its complete assistant block before content_block_stop and message_stop;
 * waiting for message_stop would deadlock tools that finish inside that stream.
 */
export class ClaudeEngineTranscript {
  private live: AgentExecutionStream | undefined
  private blockType: 'text' | 'reasoning' | 'tool-call' | undefined
  private callId: ReturnType<typeof ToolCallId> | undefined
  private readonly seen = new Set<string>()

  constructor(private readonly execution: Pick<AgentExecutionRequest, 'startMessage'>) {}

  /**
   * Publish one SDK event without duplicating its partial and completed forms.
   * @param message - SDK-decoded event from the owned CLI.
   * @returns newly committed tool calls ready for the MCP dispatcher.
   */
  accept(message: SDKMessage): ToolCallBlock[] {
    if (message.type === 'stream_event') {
      if (message.parent_tool_use_id !== null) throw new Error('Claude native subagents are not part of the DSH tool composition')
      const event = message.event
      if (event.type === 'content_block_start') {
        const type = event.content_block.type
        this.blockType = type === 'text' ? 'text' : type === 'thinking' ? 'reasoning' : type === 'tool_use' ? 'tool-call' : undefined
        if (this.blockType !== undefined) {
          this.live = this.execution.startMessage()
          this.live.push({ type: 'block-start', index: 0, blockType: this.blockType })
          if (event.content_block.type === 'tool_use') {
            this.callId = ToolCallId(event.content_block.id)
            this.live.push({ type: 'tool-call-delta', index: 0, id: this.callId,
              name: dshToolName(event.content_block.name), argumentsDelta: '' })
          }
        }
      } else if (event.type === 'content_block_delta' && this.live !== undefined) {
        switch (event.delta.type) {
          case 'text_delta':
            this.live.push({ type: 'text-delta', index: 0, text: event.delta.text })
            break
          case 'thinking_delta':
            this.live.push({ type: 'reasoning-delta', index: 0, text: event.delta.thinking })
            break
          case 'input_json_delta':
            if (this.callId === undefined) throw new Error('Claude tool argument delta has no call identity')
            this.live.push({ type: 'tool-call-delta', index: 0, id: this.callId, argumentsDelta: event.delta.partial_json })
            break
          default:
            // Tool arguments settle from the full block; signatures are provider-private.
            break
        }
      }
      return []
    }
    if (message.type !== 'assistant') return []
    if (message.parent_tool_use_id !== null) throw new Error('Claude native subagents are not part of the DSH tool composition')
    if (this.seen.has(message.uuid)) return []
    this.seen.add(message.uuid)
    const calls: ToolCallBlock[] = []
    for (const raw of message.message.content) {
      const block = contentBlock(raw)
      if (block === undefined) continue
      const stream = this.live ?? this.execution.startMessage()
      if (this.live === undefined) stream.push({ type: 'block-start', index: 0, blockType: block.type })
      stream.push({ type: 'block-end', index: 0, block })
      stream.push({ type: 'finish', reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' } })
      const settled = stream.complete()
      calls.push(...settled.content.filter(item => item.type === 'tool-call'))
      this.live = undefined
      this.blockType = undefined
      this.callId = undefined
    }
    return calls
  }
}
