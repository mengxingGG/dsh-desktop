import { describe, expect, it } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentExecutionRequest } from '@deepseek-ai/dsh-agent'
import { BlockAssembler, createAssistantMessage, type AssistantMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { ClaudeEngineTranscript } from '../src/engine-stream.ts'

function harness() {
  const messages: AssistantMessage[] = []
  const chunks: StreamChunk[] = []
  const execution: Pick<AgentExecutionRequest, 'startMessage'> = {
    startMessage: () => {
      const assembler = new BlockAssembler()
      return {
        push: (chunk) => { chunks.push(chunk); assembler.push(chunk) },
        complete: () => {
          const message = createAssistantMessage({ content: assembler.blocks(), source: { provider: 'claude-code', model: 'claude-sonnet-5' } })
          messages.push(message)
          return message
        },
      }
    },
  }
  const transcript = new ClaudeEngineTranscript(execution)
  // Captured wire fixtures omit SDK fields this projection never reads.
  const accept = (message: unknown) => transcript.accept(message as SDKMessage)
  const event = (value: unknown) => accept({ type: 'stream_event', parent_tool_use_id: null, event: value })
  return { messages, chunks, accept, event }
}

describe('Claude engine transcript', () => {
  it('commits a tool before trailing block/message stops and never duplicates its full frame', () => {
    const h = harness()
    h.event({ type: 'message_start' })
    h.event({ type: 'content_block_start', index: 0,
      content_block: { type: 'tool_use', id: 'call-1', name: 'mcp__dsh__echo', input: {} } })
    h.event({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"word":' } })
    h.event({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"probe"}' } })
    const frame = { type: 'assistant', uuid: 'block-1', parent_tool_use_id: null,
      message: { id: 'message-1', stop_reason: null,
        content: [{ type: 'tool_use', id: 'call-1', name: 'mcp__dsh__echo', input: { word: 'probe' } }] } }
    expect(h.accept(frame)).toEqual([{ type: 'tool-call', id: 'call-1', name: 'echo', arguments: '{"word":"probe"}' }])
    expect(h.messages).toHaveLength(1)
    h.event({ type: 'content_block_stop', index: 0 })
    h.event({ type: 'message_stop' })
    expect(h.accept(frame)).toEqual([])
    expect(h.messages).toHaveLength(1)
  })

  it('shows incremental text then settles the full block without double text', () => {
    const h = harness()
    h.event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    h.event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'DSH_' } })
    expect(h.chunks.at(-1)).toEqual({ type: 'text-delta', index: 0, text: 'DSH_' })
    h.accept({ type: 'assistant', uuid: 'text-1', parent_tool_use_id: null,
      message: { content: [{ type: 'text', text: 'DSH_OK' }] } })
    expect(h.messages[0]?.content).toEqual([{ type: 'text', text: 'DSH_OK' }])
  })

  it('retains successive complete blocks sharing a Claude message id', () => {
    const h = harness()
    for (const [uuid, text] of [['first', 'one'], ['second', 'two']]) {
      h.accept({ type: 'assistant', uuid, parent_tool_use_id: null,
        message: { id: 'shared-message', content: [{ type: 'text', text }] } })
    }
    expect(h.messages.map(message => message.content)).toEqual([[{ type: 'text', text: 'one' }], [{ type: 'text', text: 'two' }]])
  })

  it('rejects native tools outside the DSH agent composition', () => {
    const h = harness()
    expect(() => h.accept({ type: 'assistant', uuid: 'tool', parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', id: 'call', name: 'Bash', input: {} }] } })).toThrow('outside the DSH composition')
  })
})
