/** User-global Crew settings stored by the existing DSH settings provider. */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { CrewAgentOptionsSnapshot } from './types.ts'
import type { CrewMemoryEntry, CrewMemoryId, CrewPreferencesSnapshot, CrewPreferencesValue, CrewRole } from './preferences-types.ts'
import { crewKey } from './validation.ts'

/** DSH-global settings namespace; its persistence location belongs to settings-file. */
export const CREW_PREFERENCES_NAMESPACE = 'crew-preferences'

/** Storage and model-context limits for user-global Crew memory. */
export interface CrewPreferencesConfig {
  readonly maxEntries?: number
  readonly maxEntryChars?: number
  readonly maxTotalChars?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    crewPreferences: CrewPreferences
  }
}

/** Role defaults and editable memory shared by all projects in one DSH installation. */
export class CrewPreferences extends Service {
  static inject = ['settings']

  static Config: z<CrewPreferencesConfig> = z.object({
    maxEntries: z.number().step(1).min(1).default(128),
    maxEntryChars: z.number().step(1).min(1).default(4096),
    maxTotalChars: z.number().step(1).min(1).default(32768),
  })

  private readonly preferences: SettingsScope<CrewPreferencesValue>

  constructor(ctx: Context, config: CrewPreferencesConfig = {}) {
    super(ctx, 'crewPreferences')
    const limits = CrewPreferences.Config(config) as Required<CrewPreferencesConfig>
    const role = z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string() })
    const schema = z.object({
      roles: z.object({ manager: role, developer: role, reviewer: role, integrator: role }),
      memory: z.dict(z.object({
        kind: z.union(['preference', 'authorization']).required(),
        text: z.string().required(),
        scope: z.string().required(),
      })).default({}),
    }) as unknown as z<CrewPreferencesValue>
    this.preferences = ctx.settings.register(CREW_PREFERENCES_NAMESPACE, schema, {
      base: { roles: { manager: {}, developer: {}, reviewer: {}, integrator: {} }, memory: {} },
      validate: (value) => {
        const entries = Object.entries(value.memory)
        if (entries.length > limits.maxEntries) throw new Error(`Crew memory exceeds ${limits.maxEntries} entries`)
        let total = 0
        for (const [id, entry] of entries) {
          crewKey(id, 'memory id')
          for (const [field, text] of Object.entries({ text: entry.text, scope: entry.scope })) {
            if (text.trim().length === 0 || text.length > limits.maxEntryChars) {
              throw new Error(`Crew memory ${id}.${field} must contain 1 through ${limits.maxEntryChars} characters`)
            }
            total += text.length
          }
        }
        if (total > limits.maxTotalChars) throw new Error(`Crew memory exceeds ${limits.maxTotalChars} characters`)
        for (const [name, options] of Object.entries(value.roles)) {
          if ((options.provider === undefined) !== (options.model === undefined)) {
            throw new Error(`Crew ${name} model selection requires both provider and model`)
          }
          const fields = [options.provider, options.model, options.reasoningEffort] as Array<string | undefined>
          if (fields.some(option => option !== undefined && option.trim().length === 0)) {
            throw new Error(`Crew ${name} model options must not be empty`)
          }
        }
      },
    })
  }

  /**
   * Read current DSH-global roles and memory.
   * @returns Detached current preferences with their optimistic-write revision.
   */
  snapshot(): CrewPreferencesSnapshot {
    const descriptor = this.ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === CREW_PREFERENCES_NAMESPACE)
    if (descriptor === undefined) throw new Error('Crew global preferences are not registered')
    return { ...structuredClone(this.preferences.get()), revision: descriptor.revision }
  }

  /**
   * Resolve explicit role defaults for a new Agent; existing Agent bindings are unchanged.
   * @param role - Responsibility of the new Agent.
   * @param base - Profile-owned model defaults.
   * @returns Detached options resolved at Agent creation.
   */
  resolveRole(role: CrewRole, base: CrewAgentOptionsSnapshot): CrewAgentOptionsSnapshot {
    const selected = this.preferences.get().roles[role]
    return selected.provider === undefined
      ? { ...structuredClone(base), ...structuredClone(selected) }
      : structuredClone(selected)
  }

  /**
   * Persist one memory entry after the calling Consumer has obtained any required user approval.
   * @param id - Stable entry identifier.
   * @param entry - Remembered preference or explicitly authorized scope.
   * @param expectedRevision - Revision shown to the caller; stale edits reject without writing.
   */
  async saveMemory(id: CrewMemoryId, entry: CrewMemoryEntry, expectedRevision: number): Promise<void> {
    crewKey(id, 'memory id')
    await this.ctx.settings.mutate(CREW_PREFERENCES_NAMESPACE, [{ op: 'set', path: ['memory', id], value: entry }], expectedRevision)
  }

  /**
   * Remove one memory entry without changing role defaults or other entries.
   * @param id - Stable entry identifier.
   * @param expectedRevision - Revision shown to the caller; stale edits reject without writing.
   */
  async deleteMemory(id: CrewMemoryId, expectedRevision: number): Promise<void> {
    crewKey(id, 'memory id')
    await this.ctx.settings.mutate(CREW_PREFERENCES_NAMESPACE, [{ op: 'unset', path: ['memory', id] }], expectedRevision)
  }
}

export default CrewPreferences
