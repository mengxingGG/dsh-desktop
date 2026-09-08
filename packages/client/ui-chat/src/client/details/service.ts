/** Cross-plugin control face for the typed Chat details column. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { DetailsSelection } from '../contract/store.ts'
import type { createChatStore } from '../stores.ts'

type DetailsActions = BoundActions<ReturnType<typeof createChatStore>>

/** Public browser face used by feature header actions to open a details view. */
export interface IChatDetails {
  /**
   * Select and open one typed details view for an already rendered Session.
   * @param sessionId - manager Session owning the right column.
   * @param selection - contributed details selection.
   */
  open(sessionId: SessionId, selection: DetailsSelection): void
}

/** Per-Session action bridge between header contributions and Chat's scoped store. */
export class ChatDetailsController implements IChatDetails {
  private readonly actions = new Map<SessionId, DetailsActions>()

  /** @param layout - shared panel-geometry controller. */
  constructor(private readonly layout: ILayout) {}

  /**
   * Attach the live scoped Chat store actions when its Conversation view renders.
   * @param sessionId - Session whose Conversation view owns the actions.
   * @param actions - Bound actions from that Session's Chat store.
   */
  attach(sessionId: SessionId, actions: DetailsActions): void {
    this.actions.set(sessionId, actions)
  }

  /**
   * Remove action bridges for Sessions no longer present in the client registry.
   * @param sessionIds - Session identities still present in the client registry.
   */
  retain(sessionIds: ReadonlySet<string>): void {
    for (const sessionId of this.actions.keys()) {
      if (!sessionIds.has(sessionId)) this.actions.delete(sessionId)
    }
  }

  /** Drop all HMR-generation action bridges. */
  clear(): void {
    this.actions.clear()
  }

  /** Select a typed view before opening the shared details column. */
  open(sessionId: SessionId, selection: DetailsSelection): void {
    const actions = this.actions.get(sessionId)
    if (actions === undefined) {
      throw new Error(`ui-chat: details store for Session "${sessionId}" is not mounted`)
    }
    actions.select(selection)
    this.layout.openDetails()
  }
}
