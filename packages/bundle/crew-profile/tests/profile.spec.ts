/** The Crew profile must load four exact role presets and one safe patch layer. */

import { readFileSync } from 'node:fs'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { CREW_ROLE_TOOL_NAMES } from '@deepseek-ai/dsh-tool-crew'
import { loadCrewProfilePresets } from '../src/index.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

describe('native Crew profile bundle', () => {
  it('loads every role preset and exposes the single safe manager Agent preset', () => {
    const presets = loadCrewProfilePresets(resolve(ROOT, 'presets'))
    expect(presets.managerAgentPresetId).toBe('crew-manager')
    expect(presets.managerAgentPresetRoot).toBe(resolve(ROOT, 'presets', 'agents'))
    expect(presets.agentPresetRoots).toEqual([
      { path: resolve(ROOT, 'presets', 'agents'), trust: 'system' },
    ])
    expect(presets.roleTools).toEqual(CREW_ROLE_TOOL_NAMES)
    expect(presets.workerRoles.developer.toolFilter).toEqual({ allow: [] })
    expect(presets.workerRoles.reviewer.toolFilter).toEqual({ allow: [] })
    expect(presets.workerRoles.integrator.toolFilter).toEqual({ allow: [] })
  })

  it('composes coordination and direct coding tools for the manager', () => {
    const parsed = yaml.load(
      readFileSync(resolve(ROOT, 'presets', 'agents', 'crew-manager', 'agent.cordis.yml'), 'utf8'),
      { schema: entryListSchema },
    ) as { id?: string; name?: string; config?: unknown }[]
    const named = (rows: readonly { name?: string; config?: unknown }[]): string[] => rows.flatMap(row => [
      ...row.name === undefined ? [] : [row.name],
      ...Array.isArray(row.config) ? named(row.config as { name?: string }[]) : [],
    ])
    expect(named(parsed)).toEqual([
      '@deepseek-ai/dsh-persona',
      '@deepseek-ai/dsh-agent-instructions',
      '@deepseek-ai/dsh-tool-ask-user',
      '@deepseek-ai/dsh-tool-todo',
      '@deepseek-ai/dsh-skill-filesystem',
      '@deepseek-ai/dsh-tool-skill',
      'cordis:group',
      '@deepseek-ai/dsh-plan-mode',
      'cordis:group',
      '@deepseek-ai/dsh-compaction-basic',
      '@deepseek-ai/dsh-command-compact',
      '@deepseek-ai/dsh-compaction-tool-result-pruner',
      '@deepseek-ai/dsh-tool-pwsh',
      '@deepseek-ai/dsh-tool-bash',
      '@deepseek-ai/dsh-tool-fs',
      '@deepseek-ai/dsh-tool-fs-search',
      '@deepseek-ai/dsh-tool-jobs',
    ])
  })

  it('refuses a manager Agent preset that bypasses Crew delegation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-crew-presets-capability-'))
    try {
      await cp(resolve(ROOT, 'presets'), root, { recursive: true })
      const path = join(root, 'agents', 'crew-manager', 'agent.cordis.yml')
      const source = await readFile(path, 'utf8')
      await writeFile(path, `${source}\n- id: tool-subagent\n  name: '@deepseek-ai/dsh-tool-subagent'\n`)
      expect(() => loadCrewProfilePresets(root))
        .toThrow('names @deepseek-ai/dsh-tool-subagent, which is not a shipped Crew manager module')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a delegation bypass hidden inside a group row', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-crew-presets-nested-'))
    try {
      await cp(resolve(ROOT, 'presets'), root, { recursive: true })
      const path = join(root, 'agents', 'crew-manager', 'agent.cordis.yml')
      const source = await readFile(path, 'utf8')
      await writeFile(path, source.replace(
        "    - id: compaction-basic\n      name: '@deepseek-ai/dsh-compaction-basic'",
        "    - id: tool-subagent\n      name: '@deepseek-ai/dsh-tool-subagent'",
      ))
      expect(() => loadCrewProfilePresets(root))
        .toThrow('names @deepseek-ai/dsh-tool-subagent, which is not a shipped Crew manager module')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a manager Agent persona that drifts from the manager role preset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-crew-presets-persona-'))
    try {
      await cp(resolve(ROOT, 'presets'), root, { recursive: true })
      const path = join(root, 'roles', 'manager.yml')
      const source = await readFile(path, 'utf8')
      await writeFile(path, source.replace('You lead a DSH-native software Crew', 'You only coordinate a DSH-native software Crew'))
      expect(() => loadCrewProfilePresets(root))
        .toThrow('crew-manager Agent persona differs from manager role preset')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails profile setup when the required role preset directory is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-crew-presets-missing-'))
    try {
      expect(() => loadCrewProfilePresets(root)).toThrow('required manager role preset is missing')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects unsupported worker Agent options before profile startup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-crew-presets-options-'))
    try {
      await cp(resolve(ROOT, 'presets'), root, { recursive: true })
      const path = join(root, 'roles', 'developer.yml')
      const source = await readFile(path, 'utf8')
      await writeFile(path, source.replace('agentOptions: {}', 'agentOptions:\n  temperature: high'))
      expect(() => loadCrewProfilePresets(root)).toThrow('developer.agentOptions.temperature is not a supported Agent option')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('ships an additive layer without disabling the manager ordinary tools', () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      private?: boolean
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.private).toBeUndefined()
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(readFileSync(resolve(ROOT, 'cordis.patch.yml'), 'utf8'), {
      schema: entryListSchema,
    }) as { id?: string; disabled?: boolean; insert?: { id?: string; name?: string; config?: unknown }[] }[]
    const disabled = new Set(parsed.filter(row => row.disabled === true).map(row => row.id))
    expect(disabled.size).toBe(0)
    expect(parsed.some(row => row.id === 'system-prompt')).toBe(false)
    const inserted = parsed.flatMap(row => row.insert ?? [])
    expect(inserted.map(row => row.id)).toEqual([
      'crew-profile-presets',
      'crew-preferences',
      'invariants',
      'agent-team',
      'agent-team-invariant',
      'crew',
      'crew-invariant',
      'tool-crew',
    ])
  })
})
