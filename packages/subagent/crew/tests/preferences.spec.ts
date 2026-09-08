import { Context } from '@deepseek-ai/cordis'
import SettingsFile from '@deepseek-ai/dsh-settings-file'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CrewPreferences, CREW_PREFERENCES_NAMESPACE } from '../src/preferences.ts'
import { CrewMemoryId } from '../src/preferences-types.ts'

const contexts = new Set<Context>()
const roots: string[] = []

function directory(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-crew-preferences-'))
  roots.push(root)
  return root
}

async function fixture(dshHome = directory(), config = {}) {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SettingsFile, { dshHome, watch: false })
  await ctx.plugin(CrewPreferences, config)
  return { ctx, preferences: ctx.crewPreferences, dshHome }
}

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('DSH global Crew memory', () => {
  it('survives restart in the DSH home without writing to either project', async () => {
    const projects = directory()
    const projectA = join(projects, 'project-a')
    const projectB = join(projects, 'project-b')
    mkdirSync(projectA)
    mkdirSync(projectB)
    const first = await fixture()
    const id = CrewMemoryId('test-habit')
    const entry = { kind: 'preference' as const, text: 'Usually allow focused tests.', scope: 'All selected project directories.' }
    await first.preferences.saveMemory(id, entry, first.preferences.snapshot().revision)
    const stored = readFileSync(join(first.dshHome, 'settings.yaml'), 'utf8')
    expect(stored).toContain('crew-preferences:')
    expect(stored).toContain('Usually allow focused tests.')
    await first.ctx.fiber.dispose()
    contexts.delete(first.ctx)
    const second = await fixture(first.dshHome)
    expect(second.preferences.snapshot().memory[id]).toEqual(entry)
    expect(existsSync(join(projectA, '.dsh'))).toBe(false)
    expect(existsSync(join(projectB, '.dsh'))).toBe(false)
    expect(stored).not.toContain(projectA)
    expect(stored).not.toContain(projectB)
  })

  it('lets UI edits change and delete entries without overwriting another remembered choice', async () => {
    const { ctx, preferences } = await fixture()
    const first = CrewMemoryId('tests')
    const second = CrewMemoryId('deletion')
    await preferences.saveMemory(first, { kind: 'preference', text: 'Usually approve tests.', scope: 'Project tests.' }, 0)
    const stale = preferences.snapshot()
    await preferences.saveMemory(second, { kind: 'preference', text: 'Explain deletion first.', scope: 'All projects.' }, stale.revision)
    await expect(preferences.deleteMemory(first, stale.revision)).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
    await ctx.settings.mutate(CREW_PREFERENCES_NAMESPACE, [{ op: 'set', path: ['memory', first, 'text'], value: 'Explain long tests first.' }], preferences.snapshot().revision)
    expect(preferences.snapshot().memory[first]?.text).toBe('Explain long tests first.')
    await preferences.deleteMemory(first, preferences.snapshot().revision)
    expect(preferences.snapshot().memory[first]).toBeUndefined()
    expect(preferences.snapshot().memory[second]?.kind).toBe('preference')
  })

  it('keeps an observed habit separate from an explicitly scoped authorization', async () => {
    const { preferences } = await fixture()
    await preferences.saveMemory(CrewMemoryId('habit'), {
      kind: 'preference', text: 'The user often approves test commands.', scope: 'Development tasks.',
    }, 0)
    await preferences.saveMemory(CrewMemoryId('allow-unit-tests'), {
      kind: 'authorization', text: 'The user explicitly permits running unit tests without another prompt.', scope: 'Unit tests in the selected project only; excludes installs and destructive operations.',
    }, preferences.snapshot().revision)
    const current = preferences.snapshot()
    expect(current.memory[CrewMemoryId('habit')]?.kind).toBe('preference')
    expect(current.memory[CrewMemoryId('allow-unit-tests')]?.scope).toContain('excludes installs')
  })

  it('resolves each role independently and detaches options from subsequent edits', async () => {
    const { ctx, preferences } = await fixture()
    await ctx.settings.mutate(CREW_PREFERENCES_NAMESPACE, [{ op: 'set', path: ['roles', 'developer'], value: { provider: 'custom', model: 'developer-model', reasoningEffort: 'high' } }])
    const selected = preferences.resolveRole('developer', { provider: 'base', model: 'base-model', reasoningEffort: ReasoningEffortId('low') })
    expect(selected).toEqual({ provider: 'custom', model: 'developer-model', reasoningEffort: 'high' })
    expect(preferences.resolveRole('reviewer', { provider: 'base', model: 'base-model' })).toEqual({ provider: 'base', model: 'base-model' })
    await ctx.settings.mutate(CREW_PREFERENCES_NAMESPACE, [{ op: 'set', path: ['roles', 'developer'], value: { provider: 'custom', model: 'next-model' } }])
    expect(preferences.resolveRole('developer', { reasoningEffort: ReasoningEffortId('low') })).toEqual({ provider: 'custom', model: 'next-model' })
    expect(selected.model).toBe('developer-model')
    await expect(ctx.settings.mutate(CREW_PREFERENCES_NAMESPACE, [{ op: 'set', path: ['roles', 'integrator'], value: { provider: 'custom' } }])).rejects.toThrow('requires both provider and model')
  })

  it('rejects invalid or oversized memory without persisting it', async () => {
    const { preferences } = await fixture(undefined, { maxEntries: 1, maxEntryChars: 40, maxTotalChars: 50 })
    await expect(preferences.saveMemory(CrewMemoryId('invalid/path'), { kind: 'preference', text: 'test', scope: 'all' }, 0)).rejects.toThrow('lower-kebab-case')
    await expect(preferences.saveMemory(CrewMemoryId('empty'), { kind: 'preference', text: ' ', scope: 'all' }, 0)).rejects.toThrow('must contain')
    await expect(preferences.saveMemory(CrewMemoryId('large'), { kind: 'preference', text: 'x'.repeat(41), scope: 'all' }, 0)).rejects.toThrow('must contain')
    await expect(preferences.saveMemory(CrewMemoryId('total'), { kind: 'preference', text: 'x'.repeat(30), scope: 'x'.repeat(30) }, 0)).rejects.toThrow('exceeds 50 characters')
    await preferences.saveMemory(CrewMemoryId('first'), { kind: 'preference', text: 'Explain first.', scope: 'All projects.' }, 0)
    await expect(preferences.saveMemory(CrewMemoryId('second'), { kind: 'preference', text: 'Other.', scope: 'All projects.' }, preferences.snapshot().revision)).rejects.toThrow('exceeds 1 entries')
    expect(Object.keys(preferences.snapshot().memory)).toEqual(['first'])
  })
})
