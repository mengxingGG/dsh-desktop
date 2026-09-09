/** In-process MCP bridge exposing only the owning DSH Agent's assembled tools. */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import type { AgentExecutionRequest } from '@deepseek-ai/dsh-agent'
import { ToolCallId, type ToolCallBlock } from '@deepseek-ai/dsh-llm'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { claudeContent } from './engine-content.ts'

const metaSchema = z.object({ 'claudecode/toolUseId': z.string().min(1) })

/** Matches SDK tool callbacks with assistant calls already committed to the DSH log. */
export class ClaudeEngineTools {
  /** SDK server exposing the owning Agent's assembled DSH tools. */
  readonly config: McpSdkServerConfigWithInstance
  private readonly calls = new Map<ToolCallId, PromiseWithResolvers<ToolCallBlock>>()
  private readonly observed = new Set<ToolCallId>()
  private readonly dispatched = new Set<ToolCallId>()
  private readonly server = new McpServer({ name: 'dsh', version: '1' })
  private closed = false
  private readonly abort: () => void
  /** Whether a committed DSH tool asks the external runtime to stop iterating. */
  concluded = false

  constructor(private readonly execution: AgentExecutionRequest) {
    this.config = { type: 'sdk', name: 'dsh', instance: this.server }
    this.abort = () => {
      this.closed = true
      for (const pending of this.calls.values()) pending.reject(new Error('Claude tool bridge closed'))
    }
    execution.request.signal?.addEventListener('abort', this.abort, { once: true })
    if (execution.request.signal?.aborted) this.abort()
    this.server.server.registerCapabilities({ tools: {} })
    this.server.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: (execution.request.tools ?? []).map(tool => ({
        name: tool.name, description: tool.description,
        inputSchema: { ...tool.parameters, type: 'object' as const },
        _meta: { 'anthropic/alwaysLoad': true },
      })),
    }))
    this.server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (this.closed) throw new Error('Claude tool bridge is closed')
      const id = ToolCallId(metaSchema.parse(request.params._meta)['claudecode/toolUseId'])
      if (this.dispatched.has(id)) throw new Error('Claude tool call was already dispatched')
      this.dispatched.add(id)
      const call = await this.pending(id).promise
      if (call.name !== request.params.name || !isDeepStrictEqual(JSON.parse(call.arguments), request.params.arguments ?? {})) {
        throw new Error('Claude MCP request disagrees with its committed assistant call')
      }
      const { results, concluded } = await execution.executeTools([call])
      this.concluded ||= concluded
      const result = results[0]?.content[0]
      if (result === undefined) throw new Error('DSH did not commit the Claude tool result')
      return {
        content: await claudeContent(execution.agent.ctx, result.content, execution.request.signal),
        isError: result.isError,
        ...concluded ? { _meta: { 'claude/endTurn': true } } : {},
      }
    })
  }

  private pending(id: ToolCallId): PromiseWithResolvers<ToolCallBlock> {
    let entry = this.calls.get(id)
    if (entry === undefined) {
      entry = Promise.withResolvers<ToolCallBlock>()
      // A committed call can be cancelled before the CLI sends its MCP request.
      void entry.promise.catch(() => {})
      this.calls.set(id, entry)
    }
    return entry
  }

  /**
   * Release callbacks only after their assistant calls have committed.
   * @param calls - calls returned by the transcript projector.
   */
  observe(calls: readonly ToolCallBlock[]): void {
    if (this.closed) throw new Error('Claude tool bridge is closed')
    for (const call of calls) {
      if (this.observed.has(call.id)) throw new Error('Claude repeated an assistant tool call identity')
      this.observed.add(call.id)
      this.pending(call.id).resolve(call)
    }
  }

  /** Reject pending callbacks and close the SDK-owned MCP transport. */
  async close(): Promise<void> {
    this.execution.request.signal?.removeEventListener('abort', this.abort)
    this.abort()
    await this.server.close()
  }
}
