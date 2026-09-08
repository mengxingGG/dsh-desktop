/** Opt-in parent IPC for the desktop shell; ordinary Web launches expose no shutdown endpoint. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { parseDesktopRequest, type DesktopResponse } from './desktop-protocol.ts'

/** Stable name of the optional desktop control plugin. */
export const name = 'web-desktop-control'
/** Activity and persistence services required by the desktop Web composition. */
export const inject = ['agents', 'sessionPersistence']

/**
 * Read live work, not stored incomplete tasks or merely open Sessions.
 * @param ctx - Web host with live Agent and optional job services.
 * @returns whether an Agent, job, or contributing plugin still owns active work.
 */
export function hasActiveDesktopWork(ctx: Context): boolean {
  const agents = ctx.agents.list()
  if (agents.some(agent => agent.status === 'running' || agent.inbox.nextTurn.length > 0)) return true
  const jobs = ctx.get('jobs')
  if (jobs !== undefined) {
    for (const owner of [undefined, ...agents]) {
      if (jobs.list(owner).some(job => job.status === 'running' || job.status === 'stopping')) return true
    }
  }
  return ctx.bail('app/active-work') === true
}

/**
 * Drain task producers and Agents while persistence remains mounted, then unload the application.
 * @param ctx - desktop Web host whose task owners participate in application shutdown.
 * @returns fulfillment only after task-owner barriers and the final durable flush succeed.
 */
export async function prepareDesktopExit(ctx: Context): Promise<void> {
  await ctx.parallel('app/prepare-exit', 'producers')
  await ctx.parallel('app/prepare-exit', 'agents')
  if (hasActiveDesktopWork(ctx)) throw new Error('application work remains active after shutdown preparation')
  await ctx.sessionPersistence.flush()
  await ctx.root.fiber.dispose()
}

/**
 * Mount activity inspection and confirmation-fenced application teardown on an inherited IPC channel.
 * @param ctx - optional desktop plugin context; the launcher remains the process-exit owner.
 * @throws when this explicitly mounted plugin has no parent IPC or launcher exit service.
 */
export function apply(ctx: Context): void {
  bindDesktopParent(ctx, process)
}

/**
 * Bind the desktop protocol to one inherited process channel.
 * @param ctx - Web host whose launcher owns emergency exit after parent disconnection.
 * @param parent - inherited Node IPC transport; tests substitute an isolated event emitter.
 */
export function bindDesktopParent(ctx: Context, parent: Pick<NodeJS.Process, 'connected' | 'send' | 'channel' | 'on' | 'once' | 'off'>): void {
  const exit = ctx.get('appExit')
  if (!parent.connected || parent.send === undefined || exit === undefined) {
    throw new Error('web-desktop-control requires parent IPC and the dsh launcher')
  }
  let stopping = false
  const send = (response: DesktopResponse): Promise<void> => new Promise((resolve, reject) => {
    if (!parent.connected || parent.send === undefined) {
      reject(new Error('desktop control channel disconnected'))
      return
    }
    parent.send(response, (error) => { if (error) reject(error); else resolve() })
  })
  const onMessage = (value: unknown): void => {
    let request
    try {
      request = parseDesktopRequest(value)
    } catch {
      ctx.logger.warn('web-desktop-control rejected an invalid request')
      return
    }
    if (request === undefined) return
    const reply = (result: DesktopResponse['result']): Promise<void> => send({
      type: 'dsh/desktop', version: 1, sequence: request.sequence, result,
    })
    const respond = async (): Promise<void> => {
      try {
        if (request.operation === 'activity') {
          await reply({ kind: 'activity', busy: stopping || hasActiveDesktopWork(ctx) })
        } else if (stopping) {
          await reply({ kind: 'error', message: 'desktop shutdown is already in progress' })
        } else if (!request.confirmed && hasActiveDesktopWork(ctx)) {
          await reply({ kind: 'confirmation-required' })
        } else {
          stopping = true
          // Retain the root PID until the parent stops its tree after the durable acknowledgement.
          parent.channel?.ref()
          await prepareDesktopExit(ctx)
          await reply({ kind: 'prepared' })
        }
      } catch {
        await reply({ kind: 'error', message: 'DSH could not complete task shutdown and persistence' }).catch(() => {
          // A disconnected parent cannot consume the failure reply.
        })
      }
    }
    void respond()
  }
  const onDisconnect = (): void => { exit(0) }
  ctx.effect(() => {
    parent.on('message', onMessage)
    parent.once('disconnect', onDisconnect)
    return () => {
      parent.off('message', onMessage)
      parent.off('disconnect', onDisconnect)
    }
  }, 'web.desktop-control')
}
