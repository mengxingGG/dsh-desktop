/** Required role-preset loader and profile patch entry for native Crew. */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { CrewRolePresetSnapshot, CrewWorkerRole } from '@deepseek-ai/dsh-crew'
import type { CrewToolRole } from '@deepseek-ai/dsh-tool-crew'
import { load } from 'js-yaml'

/** Cordis plugin name. */
export const name = 'crew-profile-presets'

interface RolePresetDocumentBase {
  readonly persona: string
  readonly tools: readonly string[]
}

interface ManagerRolePresetDocument extends RolePresetDocumentBase {
  readonly role: 'manager'
}

interface WorkerRolePresetDocument extends RolePresetDocumentBase {
  readonly role: CrewWorkerRole
  readonly toolFilter: CrewRolePresetSnapshot['toolFilter']
  readonly agentOptions: CrewRolePresetSnapshot['agentOptions']
  readonly maxDepth: number
}

/**
 * One `dsh-agent-presets` roster root, in that plugin's `roots` config shape.
 * Declared structurally so this composition package does not depend on the
 * roster plugin it hands the value to.
 */
export interface CrewAgentPresetRoot {
  /** Absolute directory the roster scans for preset directories. */
  readonly path: string
  /** Trust the presets inherit; the deployment ships them, so never `user`. */
  readonly trust: 'system'
}

/** Validated immutable presets supplied to the Crew domain and tool Consumer. */
export interface CrewProfilePresets {
  /** Agent preset that mandates Crew orchestration for the sessions selecting it. */
  readonly managerAgentPresetId: 'crew-manager'
  /** Root containing the manager Agent preset directory. */
  readonly managerAgentPresetRoot: string
  /** `roots` value publishing {@link CrewProfilePresets.managerAgentPresetRoot} to the roster. */
  readonly agentPresetRoots: readonly CrewAgentPresetRoot[]
  /** Manager persona used by the headless profile and manager Agent preset. */
  readonly managerPersona: string
  /** Worker creation values snapshotted into the manager Session. */
  readonly workerRoles: Readonly<Record<CrewWorkerRole, Omit<CrewRolePresetSnapshot, 'role'>>>
  /** Exact role tool declarations checked by `dsh-tool-crew`. */
  readonly roleTools: Readonly<Record<CrewToolRole, readonly string[]>>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    crewProfilePresets: CrewProfilePresets
  }
}

const WORKER_ROLES = ['developer', 'reviewer', 'integrator'] as const

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`crew-profile: ${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`crew-profile: ${label} must be a non-empty string`)
  }
  return value.trim()
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`crew-profile: ${label} must be a non-empty string array`)
  }
  const result = value as string[]
  if (new Set(result).size !== result.length) throw new Error(`crew-profile: ${label} contains duplicate tools`)
  return structuredClone(result)
}

function optionalStringMap(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return {}
  const source = object(value, label)
  const allowed = new Set(['provider', 'model', 'reasoningEffort'])
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(source)) {
    if (!allowed.has(key)) throw new Error(`crew-profile: ${label}.${key} is not a supported Agent option`)
    result[key] = text(item, `${label}.${key}`)
  }
  return result
}

function toolFilter(value: unknown, label: string): CrewRolePresetSnapshot['toolFilter'] {
  const source = object(value, label)
  const allow = source.allow === undefined ? undefined : stringListAllowEmpty(source.allow, `${label}.allow`)
  const deny = source.deny === undefined ? undefined : stringListAllowEmpty(source.deny, `${label}.deny`)
  if (allow === undefined && deny === undefined) throw new Error(`crew-profile: ${label} must declare allow and/or deny`)
  return { ...(allow === undefined ? {} : { allow }), ...(deny === undefined ? {} : { deny }) }
}

function stringListAllowEmpty(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`crew-profile: ${label} must be a string array`)
  }
  if (new Set(value).size !== value.length) throw new Error(`crew-profile: ${label} contains duplicates`)
  return structuredClone(value as string[])
}

function readRolePreset(root: string, role: 'manager'): ManagerRolePresetDocument
function readRolePreset(root: string, role: CrewWorkerRole): WorkerRolePresetDocument
function readRolePreset(root: string, role: CrewToolRole): ManagerRolePresetDocument | WorkerRolePresetDocument {
  const path = join(root, 'roles', `${role}.yml`)
  let parsed: unknown
  try {
    parsed = load(readFileSync(path, 'utf8'))
  } catch (cause) {
    throw new Error(`crew-profile: required ${role} role preset is missing or unreadable`, { cause })
  }
  const source = object(parsed, `${role} role preset`)
  if (source.role !== role) throw new Error(`crew-profile: ${role} role preset declares the wrong role`)
  const persona = text(source.persona, `${role}.persona`)
  const tools = stringList(source.tools, `${role}.tools`)
  if (role === 'manager') return { role, persona, tools }
  const maxDepth = source.maxDepth
  if (!Number.isSafeInteger(maxDepth) || Number(maxDepth) < 0) {
    throw new Error(`crew-profile: ${role}.maxDepth must be a non-negative safe integer`)
  }
  return {
    role,
    persona,
    tools,
    toolFilter: toolFilter(source.toolFilter, `${role}.toolFilter`),
    agentOptions: optionalStringMap(source.agentOptions, `${role}.agentOptions`),
    maxDepth: Number(maxDepth),
  }
}

/**
 * Every module the `crew-manager` Agent preset may name. The preset's mandate
 * is enforced by what it cannot compose, so this is an allowlist rather than a
 * list of forbidden capabilities: a row naming anything else — a shell, an
 * unscoped filesystem tool, a delegation backend, a plugin added later — fails
 * profile activation instead of silently giving the manager a way to implement
 * a change outside the Crew workflow.
 */
const MANAGER_AGENT_PRESET_MODULES: ReadonlySet<string> = new Set([
  'cordis:group',
  '@deepseek-ai/dsh-persona',
  '@deepseek-ai/dsh-agent-instructions',
  '@deepseek-ai/dsh-tool-ask-user',
  '@deepseek-ai/dsh-tool-todo',
  '@deepseek-ai/dsh-skill-filesystem',
  '@deepseek-ai/dsh-tool-skill',
  '@deepseek-ai/dsh-plan-mode',
  '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-command-compact',
  '@deepseek-ai/dsh-compaction-tool-result-pruner',
])

/**
 * Flatten one composition into its rows, descending into every group's nested
 * `config` list. A group row's children are plugin rows too, so a check that
 * read only the top level would clear a capability nested one level down.
 */
function compositionRows(entries: readonly unknown[], label: string): Record<string, unknown>[] {
  return entries.flatMap((entry, index) => {
    const row = object(entry, `${label} row ${index}`)
    const nested = Array.isArray(row.config) ? compositionRows(row.config, `${label} row ${index} config`) : []
    return [row, ...nested]
  })
}

function assertManagerAgentPreset(root: string, manager: ManagerRolePresetDocument): void {
  const directory = join(root, 'agents', 'crew-manager')
  let parsed: unknown
  try {
    parsed = load(readFileSync(join(directory, 'agent.cordis.yml'), 'utf8'))
    readFileSync(join(directory, 'preset.yml'), 'utf8')
  } catch (cause) {
    throw new Error('crew-profile: required crew-manager Agent preset is missing or unreadable', { cause })
  }
  if (!Array.isArray(parsed)) throw new Error('crew-profile: crew-manager agent.cordis.yml must be a plugin list')
  const rows = compositionRows(parsed, 'crew-manager')
  const persona = rows.find(row => row.id === 'persona')
  const personaConfig = persona === undefined ? undefined : object(persona.config, 'crew-manager persona config')
  if (personaConfig?.text !== manager.persona) {
    throw new Error('crew-profile: crew-manager Agent persona differs from manager role preset')
  }
  const forbidden = rows.find(row => typeof row.name === 'string' && !MANAGER_AGENT_PRESET_MODULES.has(row.name))
  if (forbidden !== undefined) {
    throw new Error(`crew-profile: crew-manager Agent preset names ${String(forbidden.name)}, which is not a Crew coordination module`)
  }
}

/**
 * Read and validate all delivery-role presets before the profile can finish loading.
 * @param root - Directory containing the role and manager Agent presets.
 * @returns Frozen presets ready for Crew and tool configuration.
 */
export function loadCrewProfilePresets(root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'presets')): CrewProfilePresets {
  const manager = readRolePreset(root, 'manager')
  const workers = Object.fromEntries(
    WORKER_ROLES.map(role => [role, readRolePreset(root, role)]),
  ) as Record<CrewWorkerRole, WorkerRolePresetDocument>
  assertManagerAgentPreset(root, manager)
  const workerRoles = Object.fromEntries(WORKER_ROLES.map((role) => {
    const preset = workers[role]
    return [role, {
      persona: preset.persona,
      toolFilter: structuredClone(preset.toolFilter),
      agentOptions: structuredClone(preset.agentOptions),
      maxDepth: preset.maxDepth,
    }]
  })) as Record<CrewWorkerRole, Omit<CrewRolePresetSnapshot, 'role'>>
  const roleTools = Object.fromEntries([
    ['manager', structuredClone(manager.tools)],
    ...WORKER_ROLES.map(role => [role, structuredClone(workers[role].tools)]),
  ]) as Record<CrewToolRole, string[]>
  const agentRoot = join(root, 'agents')
  return Object.freeze({
    managerAgentPresetId: 'crew-manager' as const,
    managerAgentPresetRoot: agentRoot,
    agentPresetRoots: Object.freeze([Object.freeze({ path: agentRoot, trust: 'system' as const })]),
    managerPersona: manager.persona,
    workerRoles: Object.freeze(workerRoles),
    roleTools: Object.freeze(roleTools),
  })
}

/** Publish the validated role presets for Loader config interpolation. */
export function apply(ctx: Context): void {
  ctx.provide('crewProfilePresets', loadCrewProfilePresets())
}
