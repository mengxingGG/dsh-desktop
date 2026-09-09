/** Immutable DSH attachments projected onto Claude and MCP input blocks. */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { ContentBlock as McpContent } from '@modelcontextprotocol/sdk/types.js'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-llm'

/**
 * Resolve tool results into MCP text and image blocks in their original order.
 * @param ctx - owning Agent context with its attachment and file-path services.
 * @param blocks - committed DSH content.
 * @param signal - owning request cancellation.
 * @returns MCP blocks backed by the exact immutable DSH observations.
 */
export async function claudeContent(ctx: Context, blocks: readonly ContentBlock[], signal?: AbortSignal): Promise<McpContent[]> {
  const output: McpContent[] = []
  for (const block of blocks) {
    signal?.throwIfAborted()
    switch (block.type) {
      case 'image': {
        const attachments = ctx.get('attachments')
        if (attachments === undefined) throw new Error('Claude image input requires an attachment store')
        const stored = await attachments.readImage(block.attachment, signal)
        output.push({ type: 'image', data: Buffer.from(stored.data).toString('base64'), mimeType: stored.ref.mediaType })
        break
      }
      case 'text': case 'reasoning': output.push({ type: 'text', text: block.text }); break
      case 'file': output.push({ type: 'text', text: ctx.llm.fileRequestText(block.attachment) }); break
      case 'tool-result': output.push(...await claudeContent(ctx, block.content, signal)); break
      default:
        // Bootstrap history includes calls and extension blocks as recorded structured text.
        output.push({ type: 'text', text: JSON.stringify(block) })
    }
  }
  return output
}

/**
 * Encode DSH input with explicit message provenance and native image bytes.
 * @param ctx - owning Agent context.
 * @param messages - exact messages recorded by claude-code/prompt.
 * @param signal - cancellation while reading immutable attachments.
 * @returns one user input containing the recorded conversation or pending messages.
 */
export async function claudePrompt(ctx: Context, messages: readonly Message[], signal?: AbortSignal): Promise<MessageParam> {
  const content: Exclude<MessageParam['content'], string> = []
  for (const message of messages) {
    content.push({ type: 'text', text: JSON.stringify({ role: message.role, source: message.source }) })
    for (const block of await claudeContent(ctx, message.content, signal)) {
      if (block.type === 'text') content.push({ type: 'text', text: block.text })
      else if (block.type === 'image') {
        const mediaType = block.mimeType
        if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp' && mediaType !== 'image/gif') {
          throw new Error(`Unsupported Claude image media type: ${mediaType}`)
        }
        content.push({ type: 'image', source: { type: 'base64', data: block.data, media_type: mediaType } })
      }
    }
  }
  return { role: 'user', content }
}
