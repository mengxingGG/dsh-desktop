import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeAccountController, type AccountOperations, type AccountValue } from '../src/client/controller.ts'
import type { ClaudeLoginId } from '@deepseek-ai/dsh-subagent-claude-code/engine-types'

const idle: AccountValue = { account: { loggedIn: false, method: null, provider: null, email: null }, quota: null, login: null }
const login = { id: 'test-login' as ClaudeLoginId, status: 'running' as const, output: 'authorize', truncated: false, error: null }
const controllers: ClaudeAccountController[] = []
afterEach(() => { controllers.splice(0).forEach((controller) =>{  controller.dispose() }); vi.useRealTimers() })

function harness(overrides: Partial<AccountOperations> = {}) {
  const operations = { status: vi.fn(async () => idle), quota: vi.fn(async () => null), start: vi.fn(async () => login),
    poll: vi.fn(async () => login), input: vi.fn(async () => {}), cancel: vi.fn(async () => {}), ...overrides }
  const controller = new ClaudeAccountController(operations, 1000)
  controllers.push(controller)
  return { controller, actions: controller.inject(), operations }
}

describe('Claude account settings operations', () => {
  it('refreshes quota without starting inference or login', async () => {
    const quota = { status: 'allowed' as const, windows: { five_hour: { usedPercent: 17, resetsAt: null, updatedAt: 100 } }, usingOverage: null, updatedAt: 100 }
    const { controller, actions, operations } = harness({ quota: vi.fn(async () => quota) })
    actions.load()
    await vi.waitFor(() =>{  expect(controller.store.getSnapshot().busy).toBe(false) })
    actions.refreshQuota()
    await vi.waitFor(() =>{  expect(controller.store.getSnapshot().value?.quota).toEqual(quota) })
    expect(operations.start).not.toHaveBeenCalled()
  })

  it('retains a login even when the account was unavailable and polls its completion', async () => {
    vi.useFakeTimers()
    const { controller, actions, operations } = harness({
      poll: vi.fn(async () => ({ ...login, status: 'completed' as const })),
      status: vi.fn(async () => ({ ...idle, account: { loggedIn: true, email: 'test@example.test', provider: 'firstParty', method: 'claude.ai' }, login: { ...login, status: 'completed' as const } })),
    })
    actions.startLogin()
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.store.getSnapshot().value?.login?.status).toBe('running')
    await vi.advanceTimersByTimeAsync(1000)
    expect(controller.store.getSnapshot().value?.account?.loggedIn).toBe(true)
    expect(operations.poll).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(operations.poll).toHaveBeenCalledTimes(1)
  })

  it('ignores an account response arriving after plugin disposal', async () => {
    const response = Promise.withResolvers<AccountValue>()
    const { controller, actions } = harness({ status: () => response.promise })
    actions.load()
    controller.dispose()
    response.resolve(idle)
    await response.promise
    expect(controller.store.getSnapshot().value).toBeNull()
  })
})
