/** Isolated authoritative settings mirror for Crew component and operation tests. */

import type { ModelCatalog, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CrewPreferencesValue } from '@deepseek-ai/dsh-crew/client'
import { vi } from 'vitest'

export const catalog: ModelCatalog = {
  default: { provider: 'mock', model: 'general' },
  routableProviders: ['mock'], failures: [],
  groups: [{ id: 'mock', name: 'Mock Provider', models: [
    { id: 'general', name: 'General' },
    { id: 'reasoner', name: 'Reasoner', reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } },
  ] }],
}

export function preferencesFixture(value: CrewPreferencesValue = {
  roles: { manager: {}, developer: {}, reviewer: {}, integrator: {} }, memory: {},
}) {
  const store = createSnapshotStore<SettingsScopeSnapshot<CrewPreferencesValue>>({
    status: 'ready', mode: 'host', writable: true, revision: 1, value, base: value, user: {},
  })
  let rejectWrites = false
  const mutate = vi.fn(async (ops: readonly SettingsPathOpView[], revision?: number) => {
    if (rejectWrites || revision === undefined || revision !== store.getSnapshot().revision) return
    const next = structuredClone(store.getSnapshot().value!)
    for (const op of ops) {
      const [section, id] = op.path
      if (section !== 'roles' && section !== 'memory') throw new Error('Unexpected fixture settings section')
      if (id === undefined) throw new Error('Missing fixture settings key')
      if (op.op === 'set') Reflect.set(next[section], id, structuredClone(op.value))
      else Reflect.deleteProperty(next[section], id)
    }
    store.set({ ...store.getSnapshot(), value: next, revision: revision + 1 })
  })
  const scope: SettingsScope<CrewPreferencesValue> = {
    ...store, mutate,
    set: async () => { throw new Error('Use exact path mutations') },
    unset: async () => { throw new Error('Use exact path mutations') },
  }
  return { scope, store, mutate, reject: () => { rejectWrites = true } }
}
