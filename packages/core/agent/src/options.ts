/** Browser-safe model route overrides used when an Agent is created. */

import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'

/** Merge-extensible agent creation options. Persona belongs to system-prompt sections. */
export interface AgentOptions {
  /** Provider route served by a registered LLM adapter or Agent executor at call time. */
  provider?: string
  /** Model id interpreted by the selected provider. */
  model?: string
  /** Adapter-owned reasoning effort for the selected provider/model route. */
  reasoningEffort?: ReasoningEffortId
  /** Maximum output tokens for each conversation-model request. */
  maxTokens?: number
}
