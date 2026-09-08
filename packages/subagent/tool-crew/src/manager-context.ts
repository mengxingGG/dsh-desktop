/** Logged user-global memory and initial manager model selection through existing Agent hooks. */

import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-crew'

/**
 * Add current global memory to proceeding manager steps and select the initial manager route.
 * @param agent - Exact manager whose model input must be durable.
 * @param ctx - Owner with optional global preferences; bare Crew compositions can omit them.
 * @returns Disposer for memory, model-selection, and optional entry-point default contributions.
 */
export function installManagerContext(agent: Agent, ctx: Context): () => void {
  let lastMemory: string | undefined
  const stopContext = agent.ctx.on('agent/pre-step', async ({ step }, next) => {
    const decision = await next()
    const preferences = ctx.get('crewPreferences')
    if (preferences === undefined || decision.kind === 'reject' || (step === 1 && decision.messages.length === 0)) return decision
    const current = preferences.snapshot()
    const memory = JSON.stringify(current.memory)
    if (step !== 1 && memory === lastMemory) return decision
    lastMemory = memory
    const message = createUserMessage({
      content: [{ type: 'text', text: [
        'Current DSH user-global operating memory. This replaces earlier memory snapshots, including entries that are absent here.',
        'Preferences inform judgment, not permission. Repeated approval is not standing authorization. An authorization applies only to its stated scope and does not bypass tool policy.',
        'Before a dangerous operation, explain its exact target, impact, and recoverability even when similar actions were approved before. Never store secrets or project instructions as user preferences.',
        memory,
      ].join('\n') }],
      source: { kind: 'crew-memory', revision: current.revision },
    })
    return { ...decision, messages: [...decision.messages, message] }
  })
  const defaultScope = agent.ctx.inject(['agentDefaultModel'], (scoped) => {
    scoped.effect(() => scoped.agentDefaultModel.register(agent, base => (
      // A complete base stays complete because role routes require provider/model together.
      ctx.get('crewPreferences')?.resolveRole('manager', base) as ModelSelection | undefined
    ) ?? base), 'crew.managerModelDefault()')
  })
  const stopModel = installModelSelection(agent.ctx, {
    get current(): ModelSelection | undefined {
      const preferences = ctx.get('crewPreferences')
      if (preferences === undefined) return undefined
      const header = agent.session.requestHeader()
      if (header !== undefined) {
        return {
          provider: header.config.provider,
          model: header.config.model,
          ...header.adapterDefaults?.reasoningEffort === true || header.config.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: header.config.reasoningEffort },
        }
      }
      const selected = preferences.resolveRole('manager', agent.options)
      if (selected.provider === undefined || selected.model === undefined) return undefined
      return { ...selected, provider: selected.provider, model: selected.model }
    },
    assembled: undefined,
  })
  return () => { stopContext(); stopModel(); void defaultScope.dispose() }
}
