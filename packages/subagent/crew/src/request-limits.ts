/** Shared provider-account request admission for native and external Agent execution. */

import type { Context } from '@deepseek-ai/cordis'

interface WaitingRequest {
  readonly signal: AbortSignal
  readonly grant: () => void
}

/**
 * Register one host-wide request pool per configured provider account group.
 * External runtimes release admission while DSH tools run, including Crew waits.
 * @param ctx - Host context carrying native and external execution hooks.
 * @param defaultLimit - Maximum requests for an unlisted provider group.
 * @param limits - Explicit group limits.
 * @param groups - Provider routes sharing one account's concurrency budget.
 * @param lifecycle - Host cancellation signal.
 */
export function installRequestLimits(
  ctx: Context,
  defaultLimit: number,
  limits: Readonly<Record<string, number>>,
  groups: Readonly<Record<string, string>>,
  lifecycle: AbortSignal,
): void {
  const pools = new Map<string, { active: number; waiting: WaitingRequest[] }>()
  const acquire = async (provider: string, signal: AbortSignal): Promise<() => void> => {
    signal.throwIfAborted()
    const group = groups[provider] ?? provider
    const limit = limits[group] ?? defaultLimit
    let pool = pools.get(group)
    if (pool === undefined) { pool = { active: 0, waiting: [] }; pools.set(group, pool) }
    const owned = pool
    if (owned.active < limit) owned.active += 1
    else await new Promise<void>((resolve, reject) => {
      const entry: WaitingRequest = { signal, grant: () => { signal.removeEventListener('abort', abort); resolve() } }
      const abort = (): void => {
        const index = owned.waiting.indexOf(entry)
        if (index >= 0) owned.waiting.splice(index, 1)
        reject(signal.reason)
      }
      owned.waiting.push(entry)
      signal.addEventListener('abort', abort, { once: true })
    })
    let released = false
    return () => {
      if (released) return
      released = true
      const next = owned.waiting.shift()
      if (next === undefined) {
        owned.active -= 1
        if (owned.active === 0) pools.delete(group)
      } else next.grant()
    }
  }
  ctx.on('llm/stream', async function* (request, next) {
    const signal = request.signal === undefined ? lifecycle : AbortSignal.any([request.signal, lifecycle])
    const release = await acquire(request.provider, signal)
    try { signal.throwIfAborted(); yield* next() } finally { release() }
  })
  ctx.on('agents/execute', async (input, next) => {
    const signal = input.request.signal === undefined ? lifecycle : AbortSignal.any([input.request.signal, lifecycle])
    let release: (() => void) | undefined = await acquire(input.request.provider, signal)
    let toolQueue: Promise<unknown> = Promise.resolve()
    try {
      signal.throwIfAborted()
      return await next({
        ...input,
        executeTools: (calls) => {
          const operation = toolQueue.then(async () => {
            release?.()
            release = undefined
            const result = await input.executeTools(calls)
            release = await acquire(input.request.provider, signal)
            signal.throwIfAborted()
            return result
          })
          toolQueue = operation
          return operation
        },
      })
    } finally { release?.() }
  })
}
