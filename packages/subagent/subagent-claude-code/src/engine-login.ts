/** Native Claude authentication process; credentials remain owned by the CLI. */

import { randomUUID } from 'node:crypto'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { ClaudeOperations } from './engine-lifecycle.ts'

/** Identity of one user-initiated login attempt. */
export type ClaudeLoginId = Branded<'ClaudeLoginId'>

/** Bounded native login output and terminal status for the account settings view. */
export interface ClaudeLoginSnapshot {
  readonly id: ClaudeLoginId
  readonly status: 'running' | 'completed' | 'cancelled' | 'failed'
  readonly output: string
  readonly truncated: boolean
  readonly error: string | null
}

/** Owns at most one login attempt, including its explicit input and cancellation. */
export class ClaudeLogin {
  private starting: Promise<ClaudeLoginSnapshot> | undefined
  private attempt: {
    snapshot: ClaudeLoginSnapshot
    controller: AbortController
    child: SubprocessHandle
    done: Promise<void>
  } | undefined

  /**
   * Start the official native login command without reading its credential files.
   * @param operations - plugin lifetime owner.
   * @param spawn - scoped managed subprocess provider.
   * @param spec - fully specified native login command with bounded collected output.
   * @param timeoutMs - maximum time for browser authorization and code entry.
   * @returns the new or already running attempt.
   */
  async start(
    operations: ClaudeOperations, spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle,
    spec: SubprocessSpawnSpec, timeoutMs: number,
  ): Promise<ClaudeLoginSnapshot> {
    if (this.starting !== undefined) return this.starting
    const current = this.snapshot()
    if (current?.status === 'running') return current
    this.starting = this.startOwned(operations, spawn, spec, timeoutMs)
    try { return await this.starting }
    finally { this.starting = undefined }
  }

  private async startOwned(
    operations: ClaudeOperations, spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle,
    spec: SubprocessSpawnSpec, timeoutMs: number,
  ): Promise<ClaudeLoginSnapshot> {
    const started = Promise.withResolvers<void>()
    const work = operations.run(async (controller) => {
      const child = spawn({ ...spec, signal: controller.signal })
      const attempt = {
        snapshot: { id: randomUUID() as ClaudeLoginId, status: 'running' as ClaudeLoginSnapshot['status'], output: '', truncated: false, error: null as string | null },
        controller, child, done: Promise.resolve(),
      }
      this.attempt = attempt
      started.resolve()
      const timer = setTimeout(() =>{  controller.abort(new Error('Claude login timed out')) }, timeoutMs)
      let terminal: ClaudeLoginSnapshot = attempt.snapshot
      try {
        const result = await child.done
        terminal = { ...attempt.snapshot, status: controller.signal.aborted ? 'cancelled' : result.exitCode === 0 ? 'completed' : 'failed',
          error: result.exitCode === 0 || controller.signal.aborted ? null : `Claude login exited with code ${result.exitCode}` }
      } catch (error) {
        terminal = { ...attempt.snapshot, status: controller.signal.aborted ? 'cancelled' : 'failed', error: error instanceof Error ? error.message : String(error) }
      } finally {
        clearTimeout(timer)
        child.terminate()
        try { await child.waitForExit() }
        catch (error) {
          terminal = { ...terminal, status: 'failed', error: error instanceof Error ? error.message : String(error) }
          throw error
        } finally { attempt.snapshot = terminal }
      }
    })
    void work.catch((error: unknown) => { started.reject(error) })
    await started.promise
    const attempt = this.attempt
    if (attempt === undefined) throw new Error('Claude login was not published')
    attempt.done = work
    const snapshot = this.snapshot()
    if (snapshot === null) throw new Error('Claude login snapshot is unavailable')
    return snapshot
  }

  /**
   * Read bounded native output without retaining authorization input.
   * @returns a detached view of the latest attempt, or null before login starts.
   */
  snapshot(): ClaudeLoginSnapshot | null {
    const attempt = this.attempt
    if (attempt === undefined) return null
    const stdout = attempt.child.collected.stdout?.readFrom(0)
    const stderr = attempt.child.collected.stderr?.readFrom(0)
    return { ...attempt.snapshot, output: (stdout?.text ?? '') + (stderr?.text ?? ''), truncated: !!(stdout?.lossy || stderr?.lossy) }
  }

  /**
   * Send the user's code to the exact active attempt without retaining it.
   * @param id - identity displayed by the caller's login view.
   * @param code - one native authorization response line.
   * @returns completion after the process accepts the input bytes.
   */
  async input(id: ClaudeLoginId, code: string): Promise<void> {
    const attempt = this.attempt
    if (attempt?.snapshot.id !== id || attempt.snapshot.status !== 'running') throw new Error('Claude login attempt is no longer running')
    if (code.length === 0 || code.length > 4096 || /[\r\n\0]/u.test(code)) throw new Error('Claude login expects one nonempty response line')
    const stdin = attempt.child.stdin
    if (stdin === undefined) throw new Error('Claude login input is unavailable')
    await new Promise<void>((resolve, reject) => stdin.write(`${code}\n`, (error) => {
      if (error == null) resolve()
      else reject(error)
    }))
  }

  /**
   * Cancel only the displayed login attempt and await whole-process cleanup.
   * @param id - identity of the attempt to cancel.
   * @returns fulfillment when its managed process range is empty.
   */
  async cancel(id: ClaudeLoginId): Promise<void> {
    const attempt = this.attempt
    if (attempt?.snapshot.id !== id) throw new Error('Claude login attempt has changed')
    attempt.controller.abort()
    await attempt.done
  }
}
