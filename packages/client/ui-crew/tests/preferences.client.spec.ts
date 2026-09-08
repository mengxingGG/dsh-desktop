import { describe, expect, it, vi } from 'vitest'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import type { CrewAgentOptionsSnapshot } from '@deepseek-ai/dsh-crew/client'
import { CrewSettingsController } from '../src/client/preferences.ts'
import { catalog, preferencesFixture } from './preferences.fixture.client.ts'

describe('Crew global preferences operations', () => {
  it('writes independent roles and memory fields through revision-fenced DSH settings', async () => {
    const fixture = preferencesFixture()
    const controller = new CrewSettingsController(fixture.scope, async () => catalog)
    const face = controller.inject()
    expect(await face.saveRole('developer', { provider: 'mock', model: 'reasoner', reasoningEffort: 'high' as NonNullable<CrewAgentOptionsSnapshot['reasoningEffort']> }, 1)).toBe(true)
    expect(fixture.scope.getSnapshot().value?.roles.manager).toEqual({})
    const entry = { kind: 'preference' as const, text: 'Usually run tests.', scope: 'All projects' }
    expect(await face.saveMemory('test-habit', entry, 2)).toBe(true)
    expect(fixture.mutate).toHaveBeenLastCalledWith([{ op: 'set', path: ['memory', 'test-habit'], value: entry }], 2)
    expect(await face.deleteMemory('test-habit', 3)).toBe(true)
    expect(fixture.scope.getSnapshot().value?.memory).toEqual({})
    expect(fixture.scope.getSnapshot().value?.roles.developer.model).toBe('reasoner')
    controller.dispose()
  })

  it('does not replace newer global settings with stale drafts', async () => {
    const fixture = preferencesFixture()
    const controller = new CrewSettingsController(fixture.scope, async () => catalog)
    const face = controller.inject()
    expect(await face.saveMemory('approval', { kind: 'authorization', text: 'Run tests.', scope: 'Unit tests only' }, 1)).toBe(true)
    expect(await face.saveMemory('approval', { kind: 'preference', text: 'Old draft.', scope: 'All commands' }, 1)).toBe(false)
    expect(await face.deleteMemory('approval', 1)).toBe(false)
    expect(await face.saveRole('reviewer', { provider: 'mock', model: 'general' }, 1)).toBe(false)
    expect(Object.values(fixture.scope.getSnapshot().value!.memory)[0]?.kind).toBe('authorization')
    controller.dispose()
  })

  it('cannot persist from browser-memory mode, unavailable namespaces, or a disposed owner', async () => {
    const fixture = preferencesFixture()
    const controller = new CrewSettingsController(fixture.scope, async () => catalog)
    const face = controller.inject()
    for (const state of [
      { mode: 'memory' as const, writable: true, status: 'ready' as const },
      { mode: 'host' as const, writable: false, status: 'ready' as const },
      { mode: 'host' as const, writable: true, status: 'unavailable' as const },
    ]) {
      fixture.store.set({ ...fixture.store.getSnapshot(), ...state })
      expect(await face.saveRole('manager', {}, 1)).toBe(false)
      expect(await face.saveMemory('test', { kind: 'preference', text: 'Test', scope: 'Test' }, 1)).toBe(false)
      expect(await face.deleteMemory('test', 1)).toBe(false)
    }
    controller.dispose()
    fixture.store.set({ ...fixture.store.getSnapshot(), mode: 'host', writable: true, status: 'ready' })
    expect(await face.saveRole('integrator', {}, 1)).toBe(false)
    expect(fixture.mutate).not.toHaveBeenCalled()
  })

  it('fences catalog responses across reconnect and disposal and supports retry', async () => {
    const requests: Array<{ resolve: (value: ModelCatalog) => void; reject: (error: Error) => void }> = []
    const fetch = vi.fn(() => new Promise<ModelCatalog>((resolve, reject) => { requests.push({ resolve, reject }) }))
    const fixture = preferencesFixture()
    const controller = new CrewSettingsController(fixture.scope, fetch)
    const face = controller.inject()
    controller.refresh()
    expect(fetch).not.toHaveBeenCalled()
    face.loadCatalog()
    face.loadCatalog()
    expect(fetch).toHaveBeenCalledTimes(1)
    controller.refresh()
    expect(fetch).toHaveBeenCalledTimes(2)
    requests[0]!.resolve(catalog)
    await Promise.resolve()
    expect(controller.catalog.getSnapshot().status).toBe('loading')
    requests[1]!.reject(new Error('Directory unavailable'))
    await Promise.resolve()
    expect(controller.catalog.getSnapshot().status).toBe('error')
    face.loadCatalog()
    requests[2]!.resolve(catalog)
    await Promise.resolve()
    expect(controller.catalog.getSnapshot().value).toBe(catalog)
    controller.refresh()
    controller.dispose()
    requests[3]!.resolve({ ...catalog, groups: [] })
    await Promise.resolve()
    expect(controller.catalog.getSnapshot().status).toBe('loading')
    controller.refresh()
    face.loadCatalog()
    expect(fetch).toHaveBeenCalledTimes(4)
  })
})
