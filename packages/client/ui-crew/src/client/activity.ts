/** Secondary child-Session observation with the existing Chat projection. */

import type { ISessions, SessionObservation, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Read-only activity owned by the currently selected worker. */
export interface CrewActivitySnapshot {
  readonly sessionId: SessionId | undefined
  readonly status: 'idle' | 'loading' | 'open' | 'error'
  readonly session: SessionSnapshot | undefined
  readonly nodes: readonly ChatConversationViewNode[]
  readonly hasMore: boolean
  readonly error: string | undefined
}

/** Renderer-bound activity source and secondary-view operations. */
export interface CrewActivityInjected {
  hooks: { activity: CrewActivityController['activity'] }
  observeWorker: (id: SessionId | undefined) => () => void
  loadOlderActivity: () => void
}

/** Owns only the open panel's child observation; Session JSONL remains the history authority. */
export class CrewActivityController {
  /** Current worker records, bounded by the reader's explicit pagination. */
  readonly activity = createSnapshotStore<CrewActivitySnapshot>({
    sessionId: undefined, status: 'idle', session: undefined, nodes: [], hasMore: false, error: undefined,
  })
  private stop: () => void = () => {}
  private older: () => void = () => {}
  private readonly face: CrewActivityInjected = {
    hooks: { activity: this.activity },
    observeWorker: id => this.observe(id),
    loadOlderActivity: () => { this.older() },
  }

  /**
   * @param sessions - shared Session object and follow-stream owner.
   * @param conversations - existing Chat projection assembler.
   * @param parentId - manager Session whose exact child catalog grants observation.
   */
  constructor(
    private readonly sessions: ISessions,
    private readonly conversations: Pick<UiConversation, 'binding'>,
    private readonly parentId: SessionId,
  ) {}

  /**
   * Hand the panel its view operations without exposing the controller itself.
   * @returns plain view operations and their observable source.
   */
  inject(): CrewActivityInjected {
    return this.face
  }

  /** Release all panel subscriptions and invalidate pending catalog reads. */
  dispose(): void { this.stop(); this.older = () => {} }

  private observe(id: SessionId | undefined): () => void {
    this.dispose()
    let alive = true
    let observation: SessionObservation | undefined
    const stops: Array<() => void> = []
    const stop = () => {
      if (!alive) return
      alive = false
      for (const dispose of stops) dispose()
      observation?.dispose()
    }
    this.stop = stop
    this.activity.set({
      sessionId: id, status: id === undefined ? 'idle' : 'loading',
      session: undefined, nodes: [], hasMore: false, error: undefined,
    })
    if (id === undefined) return stop
    void this.sessions.refreshSubagents(this.parentId).then(() => {
      if (!alive) return
      const catalog = this.sessions.list.getSnapshot().subagentsByParent[this.parentId]
      const child = catalog?.entries.find(entry => entry.id === id)
      if (child?.kind !== 'child') throw new Error(catalog?.error?.message ?? 'Child Session is unavailable in its parent catalog')
      observation = this.sessions.observeSubagent({ parentSessionId: this.parentId, childSessionId: id, mode: child.mode })
      const { binding } = observation
      const chat = this.conversations.binding(binding).target('chat')
      let visibleCount = 100
      const publish = () => {
        if (!alive) return
        const session = binding.session.getSnapshot()
        const value = chat.getSnapshot()
        const nodes = value?.order.slice(-visibleCount).flatMap((key) => {
          const node = value.nodes.get(key)
          return node === undefined ? [] : [node]
        }) ?? []
        this.activity.set({
          sessionId: id, session, nodes,
          status: session.openState === 'open' ? 'open' : session.openState === 'error' ? 'error' : 'loading',
          hasMore: session.hasMore || (value?.order.length ?? 0) > visibleCount,
          error: session.openError?.message ?? session.lastAgentError ?? undefined,
        })
      }
      stops.push(binding.session.subscribe(publish), chat.subscribe(publish))
      this.older = () => {
        if (!alive) return
        visibleCount += 100
        if ((chat.getSnapshot()?.order.length ?? 0) < visibleCount) void binding.session.loadOlder()
        publish()
      }
      publish()
    }).catch((error: unknown) => {
      if (!alive) return
      stop()
      this.activity.set({
        sessionId: id, status: 'error', session: undefined, nodes: [], hasMore: false,
        error: error instanceof Error ? error.message : String(error),
      })
    })
    return stop
  }
}
