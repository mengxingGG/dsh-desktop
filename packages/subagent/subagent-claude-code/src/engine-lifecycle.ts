/** Plugin-owned abort and drain for Claude queries and account operations. */

import type { Context } from '@deepseek-ai/cordis'

/** Stops admission before aborting and joining every operation owned by the plugin. */
export class ClaudeOperations {
  private closed = false
  private readonly active = new Map<AbortController, Promise<unknown>>()

  constructor(ctx: Context) {
    ctx.effect(() => async () => {
      this.closed = true
      for (const controller of this.active.keys()) controller.abort(new Error('Claude Code plugin unloaded'))
      await Promise.allSettled(this.active.values())
    }, 'claude-code: operation ownership')
  }

  /**
   * Admit one operation and keep it owned until its cleanup has completed.
   * @param run - operation receiving its plugin-owned cancellation controller.
   * @param signal - optional caller cancellation.
   * @returns the operation result after its cleanup settles.
   */
  async run<T>(run: (controller: AbortController) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.closed) throw new Error('Claude Code plugin is unloaded')
    signal?.throwIfAborted()
    const controller = new AbortController()
    const abort = () =>{  controller.abort(signal?.reason) }
    signal?.addEventListener('abort', abort, { once: true })
    const work = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return run(controller) })
    this.active.set(controller, work)
    try { return await work }
    finally {
      this.active.delete(controller)
      signal?.removeEventListener('abort', abort)
    }
  }
}
