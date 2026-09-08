/** Versioned, parent-only IPC messages for desktop activity inspection and durable shutdown. */

/** One monotonically numbered request from the owning desktop process. */
export interface DesktopRequest {
  readonly type: 'dsh/desktop'
  readonly version: 1
  readonly sequence: number
  readonly operation: 'activity' | 'shutdown'
  readonly confirmed: boolean
}

/** A reply contains no prompts, paths, credentials, or task content. */
export interface DesktopResponse {
  readonly type: 'dsh/desktop'
  readonly version: 1
  readonly sequence: number
  readonly result:
    | { readonly kind: 'activity'; readonly busy: boolean }
    | { readonly kind: 'confirmation-required' }
    | { readonly kind: 'prepared' }
    | { readonly kind: 'error'; readonly message: string }
}

function envelope(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
    && 'type' in value && value.type === 'dsh/desktop'
}

function validSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/**
 * Validate an IPC request without interpreting unrelated parent messages.
 * @param value - decoded process-channel payload.
 * @returns validated request, or undefined for another protocol.
 * @throws when a desktop request violates the versioned protocol.
 */
export function parseDesktopRequest(value: unknown): DesktopRequest | undefined {
  if (!envelope(value)) return undefined
  if (value.version !== 1 || !validSequence(value.sequence)
    || (value.operation !== 'activity' && value.operation !== 'shutdown')
    || typeof value.confirmed !== 'boolean') {
    throw new Error('invalid desktop control request')
  }
  return value as unknown as DesktopRequest
}

/**
 * Validate a desktop reply before resolving any pending command.
 * @param value - decoded process-channel payload.
 * @returns validated reply, or undefined for another protocol.
 * @throws when a desktop reply violates the versioned protocol.
 */
export function parseDesktopResponse(value: unknown): DesktopResponse | undefined {
  if (!envelope(value)) return undefined
  const result = value.result
  if (value.version !== 1 || !validSequence(value.sequence) || typeof result !== 'object' || result === null
    || !('kind' in result)
    || !(result.kind === 'prepared' || result.kind === 'confirmation-required'
      || (result.kind === 'activity' && 'busy' in result && typeof result.busy === 'boolean')
      || (result.kind === 'error' && 'message' in result && typeof result.message === 'string'))) {
    throw new Error('invalid desktop control response')
  }
  return value as unknown as DesktopResponse
}
