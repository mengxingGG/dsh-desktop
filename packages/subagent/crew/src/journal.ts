/** Serialized Crew transactions over the exact live manager Session log. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionEventMap, SessionId } from '@deepseek-ai/dsh-session'
import type { CrewEventType } from './projection.ts'
import type { CrewProjectionState } from './types.ts'

type AppendCrewEvent = <T extends CrewEventType>(type: T, data: SessionEventMap[T]) => SessionEvent<T>

/** Owns per-manager mutation order and durable Crew event publication. */
export class CrewJournal {
  private readonly tails = new Map<SessionId, Promise<void>>()

  /** @param ctx - Crew context with Session persistence and projection services. */
  constructor(private readonly ctx: Context) {}

  /**
   * Return the authoritative projection for one exact live manager.
   * @param root - Exact live manager Agent owning the Crew Session.
   * @returns Valid current Crew projection state.
   */
  state(root: Agent): CrewProjectionState {
    const projection = this.ctx.sessionProjections.stateOf(root.session, 'crew')
    if (projection === undefined) throw new Error('Crew projection is not registered')
    if (projection.failure !== undefined) throw new Error(projection.failure)
    return projection
  }

  /**
   * Serialize one complete read-check-append transaction per manager Session.
   * @param rootId - Durable manager Session identity.
   * @param operation - Complete mutation to run after prior mutations settle.
   * @returns The operation result.
   */
  async transact<T>(rootId: SessionId, operation: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(rootId) ?? Promise.resolve()
    const run = prior.then(operation, operation)
    const tail = run.then(() => undefined, () => undefined)
    this.tails.set(rootId, tail)
    try {
      return await run
    } finally {
      if (this.tails.get(rootId) === tail) this.tails.delete(rootId)
    }
  }

  /**
   * Append and flush one root-owned Crew event before returning it.
   * @param root - Exact live manager Agent owning the Session log.
   * @param type - Crew event discriminant.
   * @param data - Payload required by that event type.
   * @returns The durable appended Session event.
   */
  async appendAndFlush<T extends CrewEventType>(
    root: Agent,
    type: T,
    data: SessionEventMap[T],
  ): Promise<SessionEvent<T>> {
    const append = root.session.append.bind(root.session) as unknown as AppendCrewEvent
    const event = append(type, data)
    await this.ctx.sessions.flush(root.session)
    return event
  }
}
