/** Global preferences operations and the model directory used by Crew settings. */

import type { ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CrewAgentOptionsSnapshot, CrewMemoryEntry, CrewPreferencesValue, CrewRole } from '@deepseek-ai/dsh-crew/client'

/** Settings namespace registered by the Host Crew preferences plugin. */
export const PREFERENCES_NAMESPACE = 'crew-preferences'

/** Four independently configurable responsibilities, in workflow order. */
export const ROLES = ['manager', 'developer', 'reviewer', 'integrator'] as const satisfies readonly CrewRole[]

/** Catalog state independent of the authoritative settings mirror. */
export interface CrewCatalogSnapshot {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly value: ModelCatalog | undefined
}

/** Plain operations and observable sources consumed through renderer-bound hooks. */
export interface CrewSettingsInjected {
  hooks: {
    preferences: SettingsScope<CrewPreferencesValue>
    catalog: CrewSettingsController['catalog']
  }
  loadCatalog: () => void
  saveRole: (role: CrewRole, options: CrewAgentOptionsSnapshot, revision: number) => Promise<boolean>
  saveMemory: (id: string, entry: CrewMemoryEntry, revision: number) => Promise<boolean>
  deleteMemory: (id: string, revision: number) => Promise<boolean>
}

/** Reads the adapter directory and writes exact fields through the existing settings scope. */
export class CrewSettingsController {
  /** Stable catalog observable; the settings scope remains the sole preferences owner. */
  readonly catalog = createSnapshotStore<CrewCatalogSnapshot>({ status: 'idle', value: undefined })
  private generation = 0
  private disposed = false

  /**
   * @param scope - DSH-global settings mirror, never project or browser storage.
   * @param fetchCatalog - Current Host model directory request.
   */
  constructor(
    private readonly scope: SettingsScope<CrewPreferencesValue>,
    private readonly fetchCatalog: () => Promise<ModelCatalog>,
  ) {}

  /**
   * Bind settings operations and observable sources for the renderer.
   * @returns Framework-bound sources and revision-fenced user operations.
   */
  inject(): CrewSettingsInjected {
    return {
      hooks: { preferences: this.scope, catalog: this.catalog },
      loadCatalog: () => { void this.load() },
      saveRole: async (role, options, revision) => {
        if (!this.writable()) return false
        await this.scope.mutate([{ op: 'set', path: ['roles', role], value: { ...options } }], revision)
        const saved = this.scope.getSnapshot().value?.roles[role]
        return !this.disposed && saved !== undefined
          && saved.provider === options.provider && saved.model === options.model
          && saved.reasoningEffort === options.reasoningEffort
      },
      saveMemory: async (id, entry, revision) => {
        if (!this.writable()) return false
        await this.scope.mutate([{ op: 'set', path: ['memory', id], value: { ...entry } }], revision)
        const saved = Object.entries(this.scope.getSnapshot().value?.memory ?? {}).find(([key]) => key === id)?.[1]
        return !this.disposed && saved?.text === entry.text && saved.scope === entry.scope && saved.kind === entry.kind
      },
      deleteMemory: async (id, revision) => {
        if (!this.writable()) return false
        await this.scope.mutate([{ op: 'unset', path: ['memory', id] }], revision)
        return !this.disposed && !Object.hasOwn(this.scope.getSnapshot().value?.memory ?? {}, id)
      },
    }
  }

  private writable(): boolean {
    const snapshot = this.scope.getSnapshot()
    return !this.disposed && snapshot.status === 'ready' && snapshot.writable && snapshot.mode === 'host'
  }

  /** Invalidate prior requests; only an already opened section reloads eagerly. */
  refresh(): void {
    if (this.disposed) return
    const opened = this.catalog.getSnapshot().status !== 'idle'
    this.generation += 1
    this.catalog.set({ status: 'idle', value: undefined })
    if (opened) void this.load()
  }

  /** Stop publishing results from the disposed Host generation. */
  dispose(): void {
    this.disposed = true
    this.generation += 1
  }

  private async load(): Promise<void> {
    if (this.disposed || this.catalog.getSnapshot().status === 'loading') return
    const generation = ++this.generation
    this.catalog.set({ status: 'loading', value: this.catalog.getSnapshot().value })
    let value: ModelCatalog
    try {
      value = await this.fetchCatalog()
    } catch {
      // Catalog transport/provider failures are exposed as the section's retryable error state.
      if (generation === this.generation) this.catalog.set({ status: 'error', value: undefined })
      return
    }
    if (generation === this.generation) this.catalog.set({ status: 'ready', value })
  }
}
