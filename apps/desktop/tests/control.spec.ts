/** Correlation and failure handling for the private desktop backend channel. */

import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { desktopControl } from '../src/control.ts'

afterEach(() => { vi.useRealTimers() })

function channel() {
  const child = Object.assign(new EventEmitter(), {
    connected: true,
    send: vi.fn((_message: unknown, callback: (error: Error | null) => void) => { callback(null) }),
  })
  const control = desktopControl(child as unknown as ChildProcess, 500)
  const reply = (sequence: number, result: unknown): void => {
    child.emit('message', { type: 'dsh/desktop', version: 1, sequence, result })
  }
  return { child, control, reply }
}

it('correlates replies even when two activity requests settle out of order', async () => {
  const { child, control, reply } = channel()
  try {
    const first = control.activity()
    const second = control.activity()
    child.emit('message', { type: 'unrelated' })
    reply(2, { kind: 'activity', busy: true })
    reply(1, { kind: 'activity', busy: false })
    expect(await Promise.all([first, second])).toEqual([false, true])
  } finally { child.emit('close') }
  expect(child.listenerCount('message')).toBe(0)
  expect(child.listenerCount('disconnect')).toBe(0)
  expect(child.listenerCount('error')).toBe(0)
})

it('preserves the confirmation fence and accepts only the durable preparation acknowledgement', async () => {
  const { child, control, reply } = channel()
  try {
    const refused = control.shutdown(false)
    expect(child.send.mock.calls[0]?.[0]).toMatchObject({ operation: 'shutdown', confirmed: false })
    reply(1, { kind: 'confirmation-required' })
    expect(await refused).toBe(false)
    const confirmed = control.shutdown(true)
    expect(child.send.mock.calls[1]?.[0]).toMatchObject({ operation: 'shutdown', confirmed: true })
    reply(2, { kind: 'prepared' })
    expect(await confirmed).toBe(true)
  } finally { child.emit('close') }
})

it.each(['close', 'disconnect', 'error'] as const)('rejects a pending request when the child emits %s', async (event) => {
  const { child, control } = channel()
  try {
    const failed = expect(control.activity()).rejects.toThrow()
    child.emit(event, new Error('owned child failed'))
    await failed
  } finally { child.emit('close') }
})

it('rejects unavailable channels and synchronous or asynchronous send failures', async () => {
  const { child, control } = channel()
  try {
    child.connected = false
    await expect(control.activity()).rejects.toThrow('unavailable')
    child.connected = true
    child.send.mockImplementationOnce(() => { throw new Error('send threw') })
    await expect(control.activity()).rejects.toThrow('send threw')
    child.send.mockImplementationOnce((_message, callback) => { callback(new Error('send failed')) })
    await expect(control.activity()).rejects.toThrow('send failed')
  } finally { child.emit('close') }
})

it('rejects malformed, failed, and operation-mismatched replies', async () => {
  const { child, control, reply } = channel()
  try {
    const invalid = expect(control.activity()).rejects.toThrow('invalid desktop control response')
    reply(1, { kind: 'activity', busy: 'yes' })
    await invalid
    const failed = expect(control.shutdown(true)).rejects.toThrow('storage failed')
    reply(2, { kind: 'error', message: 'storage failed' })
    await failed
    const mismatch = expect(control.activity()).rejects.toThrow('unexpected desktop activity')
    reply(3, { kind: 'prepared' })
    await mismatch
    const wrongStop = expect(control.shutdown(true)).rejects.toThrow('unexpected desktop shutdown')
    reply(4, { kind: 'activity', busy: false })
    await wrongStop
  } finally { child.emit('close') }
})

it('bounds unresponsive requests and ignores late replies', async () => {
  vi.useFakeTimers()
  const { child, control, reply } = channel()
  try {
    const expired = expect(control.activity()).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(500)
    await expired
    reply(1, { kind: 'activity', busy: true })
    const current = control.activity()
    reply(2, { kind: 'activity', busy: false })
    expect(await current).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  } finally { child.emit('close') }
})
