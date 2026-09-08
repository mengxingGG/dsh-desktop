/** Live-work inspection and durability barriers used before desktop process-tree exit. */

import { Context } from '@deepseek-ai/cordis'
import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { apply, bindDesktopParent, hasActiveDesktopWork, prepareDesktopExit } from '../src/desktop.ts'
import { parseDesktopRequest, parseDesktopResponse } from '../src/desktop-protocol.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

function host() {
  const ctx = new Context()
  contexts.push(ctx)
  const list = vi.fn(() => [] as Array<{ status: string; inbox: { nextTurn: unknown[] } }>)
  const flush = vi.fn().mockResolvedValue(undefined)
  ctx.provide('agents', { list } as never)
  ctx.provide('sessionPersistence', { flush } as never)
  return { ctx, list, flush }
}

it('does not treat idle Sessions or completed jobs as active work', () => {
  const { ctx, list } = host()
  list.mockReturnValue([{ status: 'idle', inbox: { nextTurn: [] } }])
  ctx.provide('jobs', { list: () => [{ status: 'completed' }, { status: 'failed' }, { status: 'killed' }] } as never)
  expect(hasActiveDesktopWork(ctx)).toBe(false)
})

it.each(['running', 'queued'] as const)('finds %s Agent work', (status) => {
  const { ctx, list } = host()
  list.mockReturnValue([{ status: status === 'running' ? 'running' : 'idle', inbox: { nextTurn: status === 'queued' ? [{}] : [] } }])
  expect(hasActiveDesktopWork(ctx)).toBe(true)
})

it.each(['running', 'stopping'] as const)('finds %s jobs for unowned and exact Agent buckets', (status) => {
  const { ctx, list } = host()
  const agent = { status: 'idle', inbox: { nextTurn: [] } }
  list.mockReturnValue([agent])
  const jobs = vi.fn((owner?: unknown) => owner === agent ? [{ status }] : [])
  ctx.provide('jobs', { list: jobs } as never)
  expect(hasActiveDesktopWork(ctx)).toBe(true)
  expect(jobs.mock.calls).toEqual([[undefined], [agent]])
  list.mockReturnValue([])
  jobs.mockReturnValue([{ status }])
  expect(hasActiveDesktopWork(ctx)).toBe(true)
})

it('includes plugin-owned work and unregisters it with its owner', () => {
  const { ctx } = host()
  const contribution = ctx.on('app/active-work', () => true)
  expect(hasActiveDesktopWork(ctx)).toBe(true)
  contribution()
  expect(hasActiveDesktopWork(ctx)).toBe(false)
})

it('drains producers before Agents, flushes after their closing events, and then disposes', async () => {
  const { ctx, flush } = host()
  const producer = Promise.withResolvers<undefined>()
  const sequence: string[] = []
  ctx.on('app/prepare-exit', async (stage) => {
    sequence.push(stage)
    if (stage === 'producers') await producer.promise
  })
  flush.mockImplementation(async () => { sequence.push('flush') })
  ctx.effect(() => () => { sequence.push('dispose') }, 'desktop.test-resource')
  const stop = prepareDesktopExit(ctx)
  try {
    await expect.poll(() => sequence).toEqual(['producers'])
    expect(flush).not.toHaveBeenCalled()
  } finally { producer.resolve(undefined) }
  await stop
  expect(sequence).toEqual(['producers', 'agents', 'flush', 'dispose'])
})

it.each(['producers', 'agents', 'flush'] as const)('refuses a successful exit when the %s barrier fails', async (failing) => {
  const { ctx, flush } = host()
  const disposed = vi.fn()
  ctx.effect(() => disposed, 'desktop.test-resource')
  const failure = new Error(`${failing} failed`)
  ctx.on('app/prepare-exit', async (stage) => { if (stage === failing) throw failure })
  if (failing === 'flush') flush.mockRejectedValue(failure)
  if (failing === 'flush') await expect(prepareDesktopExit(ctx)).rejects.toBe(failure)
  else await expect(prepareDesktopExit(ctx)).rejects.toMatchObject({ errors: [failure] })
  expect(disposed).not.toHaveBeenCalled()
})

function parentChannel(ctx: Context) {
  const exit = vi.fn()
  ctx.provide('appExit', exit)
  const channel = Object.assign(new EventEmitter(), {
    connected: true, channel: { ref: vi.fn() },
    send: vi.fn((_message: unknown, callback: (error: Error | null) => void) => { callback(null); return true }),
  })
  bindDesktopParent(ctx, channel as unknown as Parameters<typeof bindDesktopParent>[1])
  const request = (operation: 'activity' | 'shutdown', confirmed = false): void => {
    channel.emit('message', { type: 'dsh/desktop', version: 1, sequence: 1, operation, confirmed })
  }
  return { channel, exit, request }
}

it('requires an inherited channel and a launcher, and ignores unrelated or invalid IPC', async () => {
  const { ctx } = host()
  expect(() => { apply(ctx) }).toThrow('requires parent IPC')
  const { channel } = parentChannel(ctx)
  const warning = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  try {
    channel.emit('message', { type: 'unrelated' })
    channel.emit('message', { type: 'dsh/desktop', version: 2 })
    expect(channel.send).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledOnce()
  } finally { warning.mockRestore(); await ctx.fiber.dispose() }
  expect(channel.listenerCount('message')).toBe(0)
  expect(channel.listenerCount('disconnect')).toBe(0)
})

it('refuses unconfirmed busy shutdown without changing work and acknowledges only after durable preparation', async () => {
  const { ctx, flush } = host()
  let busy = true
  ctx.on('app/active-work', () => busy || undefined)
  ctx.on('app/prepare-exit', (stage) => { if (stage === 'agents') busy = false })
  const { channel, request, exit } = parentChannel(ctx)
  request('activity')
  request('shutdown')
  expect(channel.send.mock.calls.map(call => call[0])).toMatchObject([
    { result: { kind: 'activity', busy: true } }, { result: { kind: 'confirmation-required' } },
  ])
  expect(flush).not.toHaveBeenCalled()
  const saved = Promise.withResolvers<undefined>()
  flush.mockReturnValue(saved.promise)
  request('shutdown', true)
  request('shutdown', true)
  try {
    await expect.poll(() => flush.mock.calls.length).toBe(1)
    expect(channel.send.mock.calls.map(call => call[0])).not.toContainEqual(expect.objectContaining({ result: { kind: 'prepared' } }))
    expect(channel.send.mock.calls.at(-1)?.[0]).toMatchObject({ result: { kind: 'error' } })
  } finally { saved.resolve(undefined) }
  await expect.poll(() => channel.send.mock.calls.at(-1)?.[0]).toMatchObject({ result: { kind: 'prepared' } })
  expect(channel.channel.ref).toHaveBeenCalledOnce()
  expect(exit).not.toHaveBeenCalled()
})

it('refuses to acknowledge a task owner that leaves work active after preparation', async () => {
  const { ctx, flush } = host()
  ctx.on('app/active-work', () => true)
  await expect(prepareDesktopExit(ctx)).rejects.toThrow('work remains active')
  expect(flush).not.toHaveBeenCalled()
})

it('reports failed persistence without acknowledging preparation or exiting', async () => {
  const { ctx, flush } = host()
  flush.mockRejectedValue(new Error('disk full'))
  const { channel, request, exit } = parentChannel(ctx)
  request('shutdown')
  await expect.poll(() => channel.send.mock.calls.at(-1)?.[0]).toMatchObject({ result: { kind: 'error' } })
  expect(exit).not.toHaveBeenCalled()
})

it('contains reply transport failures and requests launcher cleanup after parent disconnection', async () => {
  const { ctx } = host()
  const { channel, request, exit } = parentChannel(ctx)
  const failedReply = Promise.withResolvers<undefined>()
  channel.send.mockImplementation((_message, callback) => { callback(new Error('channel closed')); failedReply.resolve(undefined); return false })
  request('activity')
  await failedReply.promise
  channel.connected = false
  channel.emit('disconnect')
  expect(exit).toHaveBeenCalledWith(0)
})

it('validates only versioned desktop messages', () => {
  expect(parseDesktopRequest(null)).toBeUndefined()
  expect(parseDesktopResponse({ type: 'other' })).toBeUndefined()
  const message = { type: 'dsh/desktop', version: 1, sequence: 1, operation: 'activity', confirmed: false }
  expect(parseDesktopRequest(message)).toEqual(message)
  expect(() => parseDesktopRequest({ ...message, version: 2 })).toThrow('invalid')
  expect(() => parseDesktopRequest({ ...message, sequence: 0 })).toThrow('invalid')
  expect(() => parseDesktopRequest({ ...message, sequence: 1.5 })).toThrow('invalid')
  expect(() => parseDesktopRequest({ ...message, operation: 'kill' })).toThrow('invalid')
  expect(() => parseDesktopRequest({ ...message, confirmed: 'true' })).toThrow('invalid')
  for (const result of [{ kind: 'prepared' }, { kind: 'confirmation-required' }, { kind: 'activity', busy: true }, { kind: 'error', message: 'failed' }]) {
    expect(parseDesktopResponse({ ...message, result })?.result).toEqual(result)
  }
  for (const result of [null, {}, { kind: 'activity' }, { kind: 'error', message: 1 }, { kind: 'unexpected' }]) {
    expect(() => parseDesktopResponse({ ...message, result })).toThrow('invalid')
  }
})
