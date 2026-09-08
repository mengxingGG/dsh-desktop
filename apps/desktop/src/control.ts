/** Correlated desktop control requests on one owned backend's private process channel. */

import type { ChildProcess } from 'node:child_process'
import {
  parseDesktopResponse, type DesktopRequest, type DesktopResponse,
} from '@deepseek-ai/dsh-web-app/desktop-protocol'

/** Activity inspection and confirmation-fenced durable stop operations. */
export interface DesktopControl {
  /** Inspect live backend work without changing any task. */
  activity(): Promise<boolean>
  /** Stop and persist, or return false when newly active work still needs confirmation. */
  shutdown(confirmed: boolean): Promise<boolean>
}

/**
 * Attach a single request/reply owner to a backend started with stdio IPC.
 * @param child - exact child process whose channel carries the control protocol.
 * @param timeoutMs - bounded wait for an activity or durable-shutdown reply.
 * @returns lifecycle-bound control methods; child close rejects all outstanding requests.
 */
export function desktopControl(child: ChildProcess, timeoutMs: number): DesktopControl {
  let sequence = 0
  const pending = new Map<number, {
    resolve(value: DesktopResponse['result']): void
    reject(error: Error): void
  }>()
  const rejectPending = (error: Error): void => {
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
  }
  const onMessage = (value: unknown): void => {
    try {
      const response = parseDesktopResponse(value)
      if (response !== undefined) pending.get(response.sequence)?.resolve(response.result)
    } catch (error) {
      rejectPending(error instanceof Error ? error : new Error(String(error)))
    }
  }
  const onClose = (): void => {
    rejectPending(new Error('desktop backend control channel closed'))
    child.off('message', onMessage)
    child.off('disconnect', onDisconnect)
    child.off('error', onError)
  }
  const onDisconnect = (): void => { rejectPending(new Error('desktop backend control channel disconnected')) }
  const onError = (error: Error): void => { rejectPending(error) }
  child.on('message', onMessage)
  child.once('close', onClose)
  child.on('disconnect', onDisconnect)
  child.on('error', onError)

  const request = async (operation: DesktopRequest['operation'], confirmed = false): Promise<DesktopResponse['result']> => {
    if (!child.connected) throw new Error('desktop backend control channel is unavailable')
    const current = ++sequence
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await new Promise<DesktopResponse['result']>((resolve, reject) => {
        pending.set(current, { resolve, reject })
        timeout = setTimeout(() => { reject(new Error('desktop backend control request timed out')) }, timeoutMs)
        const message: DesktopRequest = { type: 'dsh/desktop', version: 1, sequence: current, operation, confirmed }
        child.send(message, (error) => { if (error) reject(error) })
      })
    } finally {
      clearTimeout(timeout)
      pending.delete(current)
    }
  }
  return {
    async activity() {
      const result = await request('activity')
      if (result.kind === 'activity') return result.busy
      throw new Error(result.kind === 'error' ? result.message : 'unexpected desktop activity response')
    },
    async shutdown(confirmed) {
      const result = await request('shutdown', confirmed)
      if (result.kind === 'prepared') return true
      if (result.kind === 'confirmation-required') return false
      throw new Error(result.kind === 'error' ? result.message : 'unexpected desktop shutdown response')
    },
  }
}
