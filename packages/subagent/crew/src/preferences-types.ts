/** Browser-safe user-global Crew preferences and remembered operating choices. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { CrewAgentOptionsSnapshot, CrewWorkerRole } from './types.ts'

/** The manager and the three native worker responsibilities. */
export type CrewRole = 'manager' | CrewWorkerRole

/** Stable identity of one user-global memory entry. */
export type CrewMemoryId = Branded<'CrewMemoryId'>

/**
 * Brand a validated memory identifier.
 * @param id - Validated opaque identifier.
 * @returns Branded memory identifier.
 */
export function CrewMemoryId(id: string): CrewMemoryId {
  return id as CrewMemoryId
}

/** A preference is evidence for judgment; an authorization requires an explicit user instruction. */
export interface CrewMemoryEntry {
  readonly kind: 'preference' | 'authorization'
  readonly text: string
  /** User-described applicability, not an executable permission expression. */
  readonly scope: string
}

/** Stored under DSH settings, independently of project and Session directories. */
export interface CrewPreferencesValue {
  readonly roles: Readonly<Record<CrewRole, CrewAgentOptionsSnapshot>>
  readonly memory: Readonly<Record<CrewMemoryId, CrewMemoryEntry>>
}

/** One user-global view whose revision fences edits from both the UI and manager tools. */
export interface CrewPreferencesSnapshot extends CrewPreferencesValue {
  readonly revision: number
}
