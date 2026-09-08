/** Chat-owned selection state shared by the transcript and details panel. */

/** Tool call identity as carried by Chat nodes. */
export type ToolCallId = string

/** Tool-call branch of the typed details selection registry. */
export interface ToolDetailsSelection {
  readonly kind: 'tool'
  turnSeq: number
  stepSeq?: number
  callId?: ToolCallId
  toolName?: string
}

/** Merge-extensible registry of right-column details selections. */
export interface DetailsSelectionMap {}

/** Any details selection contributed to the current client program. */
export type DetailsSelection = DetailsSelectionMap[keyof DetailsSelectionMap]

/** Backward-compatible name for the built-in Tool details selection. */
export type SelectionTarget = ToolDetailsSelection

/** One manually expanded Turn answer generation. */
export interface TurnProcessViewEntry {
  readonly turn: number
  readonly answerStep: number
}

/** Per-Session state shared only by the Chat view and details surface. */
export interface ChatStoreState {
  selection: DetailsSelection | null
  turnProcesses: TurnProcessViewEntry[]
}
