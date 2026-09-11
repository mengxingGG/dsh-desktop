/** Last-observation projection for native CLI invocation metrics. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from './events.ts'
import type {} from './types.ts'
const count = z.number().nonnegative().nullable()
const schema = z.object({
  provider: z.enum(['grok-cli', 'antigravity-cli', 'codex-cli']), model: z.string(),
  inputTokens: count, outputTokens: count, cacheReadTokens: count, cacheWriteTokens: count,
  contextTokens: count, contextWindow: count, costUsd: count, updatedAt: z.number().nonnegative(),
}).strict().nullable()
/** Reopened conversations retain the latest native observation. */
export const cliUsageProjection = {
  key: 'cliUsage', stateVersion: 1, stateSchema: schema, init: () => null,
  apply: (state, event) => event.type === 'cli-agent/usage' ? event.data : state,
  wire: { viewSchema: schema, view: state => state },
} satisfies ProjectionDefinition<'cliUsage'>
