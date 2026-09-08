/** Deterministic model used only while recording the Crew SDK projection. */

import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'

function called(messages, name) {
  return messages.some(message => message.role === 'assistant'
    && message.content.some(block => block.type === 'tool-call' && block.name === name))
}

function toolChunks() {
  const id = ToolCallId('crew-sdk-write')
  const args = JSON.stringify({
    path: 'projection.txt',
    content: 'Crew event reached the SDK.\n',
  })
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name: 'crew_write_file', argumentsDelta: args },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'crew_write_file', arguments: args } },
    { type: 'usage', usage: { inputTokens: 3, outputTokens: 3 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function textChunks() {
  const text = 'CREW_SDK_PROJECTION_OK'
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 3, outputTokens: 3 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class CrewSdkFixtureAdapter extends LlmAdapter {
  async * stream(options) {
    const chunks = called(options.messages, 'crew_write_file') ? textChunks() : toolChunks()
    for (const chunk of chunks) {
      options.signal?.throwIfAborted()
      yield chunk
    }
  }
}

/** Cordis plugin name. */
export const name = 'crew-sdk-fixture-llm'
/** The fixture contributes one model adapter. */
export const inject = ['llm']

/** Register the fixture only while the committed Session is recorded. */
export function apply(ctx) {
  if (process.env.DSH_SNAPSHOT !== 'replay' && process.env.DSH_SNAPSHOT !== 'refresh') {
    ctx.llm.registerAdapter(['deepseek-official'], new CrewSdkFixtureAdapter())
  }
}
