/** Structured CLI responses are validated before any DSH tool can execute. */
import { z } from 'zod'
import assert from 'node:assert/strict'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { CliProvider, CliQuotaWindow, CliUsage } from './types.ts'

/** Native runtimes produce one response; DSH owns every requested tool effect. */
export const BRIDGE_INSTRUCTIONS = 'You are the selected DSH agent. Follow the supplied system instructions and conversation. Native project tools are disabled. Return only the required JSON object: text contains your user-visible response; calls contains requested DSH tools, each with name and arguments encoded as a JSON object string. Use only the supplied tool catalog. Do not invent tool results. After requesting tools, wait for the next input with their results. Use an empty calls array when finished.'

const responseSchema = z.object({
  text: z.string(), calls: z.array(z.object({ name: z.string().min(1), arguments: z.string() }).strict()),
}).strict()
/** Parsed response envelope whose argument strings contain JSON objects. */
export type CliResponse = z.infer<typeof responseSchema>

/**
 * Build a native structured-output schema from the admitted tool names.
 * @param tools - Exact Agent-scoped tool definitions.
 * @returns JSON schema serialized for the CLI flag.
 */
export function outputSchema(tools: readonly ToolSchema[]): string {
  return JSON.stringify({ type: 'object', additionalProperties: false,
    properties: { text: { type: 'string' }, calls: { type: 'array',
      ...tools.length === 0 ? { maxItems: 0 } : {},
      items: { type: 'object', additionalProperties: false,
        properties: { name: { type: 'string', ...tools.length === 0 ? {} : { enum: tools.map(tool => tool.name) } },
          arguments: { type: 'string', description: 'JSON object encoded as a string.' } }, required: ['name', 'arguments'] } } },
    required: ['text', 'calls'] })
}

/**
 * Reject malformed output and unadvertised tools before committing calls.
 * @param raw - Native structured output.
 * @param tools - Admitted tool catalog.
 * @returns Validated response with object-valued arguments.
 */
export function parseResponse(raw: unknown, tools: readonly ToolSchema[]): CliResponse {
  const value = responseSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw)
  for (const call of value.calls) {
    if (!tools.some(tool => tool.name === call.name)) throw new Error('CLI requested an unavailable DSH tool: ' + call.name)
    const args: unknown = JSON.parse(call.arguments)
    if (args === null || Array.isArray(args) || typeof args !== 'object') throw new Error('CLI tool arguments must encode an object')
  }
  if (!value.text && value.calls.length === 0) throw new Error('CLI returned an empty response')
  return value
}

/**
 * Decode native model directory lines without inventing models from diagnostics.
 * @param provider - CLI whose directory is being decoded.
 * @param text - Native models command stdout.
 * @returns Distinct native identifiers and labels.
 */
export function parseModels(provider: CliProvider, text: string): { id: string; name: string }[] {
  const values = new Map<string, { id: string; name: string }>()
  for (const line of text.split(/\r?\n/u)) {
    const match = provider === 'grok-cli'
      ? line.match(/^\s*[*-]\s+([\w.-]+)(?:\s+\(default\))?\s*$/u)
      : line.match(/^([\w.-]+)\t+(.+)$/u)
    if (match?.[1]) values.set(match[1], { id: match[1], name: match[2]?.trim() || match[1] })
  }
  return [...values.values()]
}

/**
 * Normalize only native quota rows; model prose is never a balance estimate.
 * @param text - Native /usage table.
 * @returns Dynamic quota windows, with remaining percentages converted to used.
 */
export function parseQuota(text: string): CliQuotaWindow[] {
  const windows: CliQuotaWindow[] = []
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^(.+?)\s{2,}(.+?)\s+Remaining\s+(\d+(?:\.\d+)?)%\s+(\S+)\s*$/u)
    if (!match) continue
    const [, pool, window, percent, reset] = match
    assert(pool !== undefined && window !== undefined && percent !== undefined && reset !== undefined)
    const remaining = Number(percent), resetsAt = Date.parse(reset)
    if (remaining < 0 || remaining > 100 || !Number.isFinite(resetsAt)) throw new Error('Invalid native quota row')
    windows.push({ pool: pool.trim(), window: window.trim(), usedPercent: 100 - remaining, resetsAt })
  }
  if (!windows.length) throw new Error('The CLI did not return a native quota table')
  return windows
}

/**
 * Keep invocation counts separate from cumulative Antigravity counters.
 * @param provider - Native accounting convention.
 * @param model - Requested native model.
 * @param current - Validated result counters.
 * @param previous - Last completed native counters for the same conversation.
 * @param costUsd - Cost supplied by the CLI, unrelated to subscription balance.
 * @returns Latest invocation measurement; context capacity stays unknown.
 */
export function usageSample(provider: CliProvider, model: string, current: Readonly<Record<string, number>>,
  previous: Readonly<Record<string, number>>, costUsd: number | null): CliUsage {
  const count = (key: string): number | null => {
    const value = current[key]
    if (value === undefined) return null
    const delta = provider === 'antigravity-cli' ? value - (previous[key] ?? 0) : value
    return delta < 0 ? null : delta
  }
  return { provider, model, inputTokens: count('input_tokens'), outputTokens: count('output_tokens'),
    cacheReadTokens: count(provider === 'grok-cli' ? 'cache_read_input_tokens' : 'cache_read_tokens'),
    cacheWriteTokens: count('cache_creation_input_tokens'), contextTokens: null, contextWindow: null,
    costUsd, updatedAt: Date.now() }
}
