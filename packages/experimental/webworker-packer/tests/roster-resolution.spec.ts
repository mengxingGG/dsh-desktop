/** Profile-local plugins must remain loadable after dependency collection and sweeping. */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { WorkerModuleLoader } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/module-system/module-loader.ts'
import { inflateImage } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/storage/image-gzip.ts'
import { loadVfsImage } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/storage/memory.ts'
import { DEFAULT_ROOT, packVfsImage } from '../src/pack.ts'

const PLUGIN = '@preview/plugin'
const HELPER = '@preview/helper'

function packageAt(directory: string, name: string, source: string, dependencies: Record<string, string> = {}, version = '1.0.0'): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    name, version, type: 'module', exports: './index.js', dependencies,
  }))
  writeFileSync(join(directory, 'index.js'), source)
}

function fixture(): { root: string; profile: string; plugin: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pack-roster-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const profile = join(root, 'profiles', 'web')
  const plugin = join(root, 'bundle', 'node_modules', PLUGIN)
  packageAt(plugin, PLUGIN, `import { value } from '${HELPER}'; export const answer = value + 1;`, { [HELPER]: '1.0.0' })
  const projected = join(profile, 'node_modules', PLUGIN)
  mkdirSync(join(profile, 'node_modules', '@preview'), { recursive: true })
  symlinkSync(plugin, projected, 'junction')
  return { root, profile, plugin }
}

it('packs and loads an external roster plugin through the selected profile, including its own dependencies', async () => {
  const { root, profile, plugin } = fixture()
  packageAt(join(plugin, 'node_modules', HELPER), HELPER, 'export const value = 41;')
  const result = packVfsImage({
    config: `- name: '${PLUGIN}'\n`, profile: 'web', workspaces: new Map(),
    resolveFrom: root, rosterResolveFrom: profile, entries: [],
  })
  expect(result.missing).toEqual([])
  expect(result.roster).toEqual([PLUGIN])
  expect(result.packages.has(HELPER)).toBe(true)
  const vfs = loadVfsImage(await inflateImage(result.image, 'profile-local roster'), DEFAULT_ROOT)
  const loader = new WorkerModuleLoader({ vfs, root: DEFAULT_ROOT, staticModules: {} })
  expect(loader.requireFrom(`${DEFAULT_ROOT}/config`)(PLUGIN)).toEqual({ answer: 42 })
})

it('reports the plugin missing when only the repository root is available', () => {
  const { root } = fixture()
  const result = packVfsImage({
    config: `- name: '${PLUGIN}'\n`, profile: 'web', workspaces: new Map(), resolveFrom: root, entries: [],
  })
  expect(result.missing).toEqual([`${PLUGIN} (from .)`])
  expect(result.packages.has(PLUGIN)).toBe(false)
})

it('does not resolve a transitive dependency through unrelated profile packages', () => {
  const { root, profile } = fixture()
  packageAt(join(profile, 'node_modules', HELPER), HELPER, 'export const value = 41;')
  const result = packVfsImage({
    config: `- name: '${PLUGIN}'\n`, profile: 'web', workspaces: new Map(),
    resolveFrom: root, rosterResolveFrom: profile, entries: [],
  })
  expect(result.missing.map(entry => entry.replaceAll('\\', '/')))
    .toEqual([`${HELPER} (from bundle/node_modules/${PLUGIN})`])
  expect(result.packages.has(HELPER)).toBe(false)
})

it('keeps incompatible installed copies under their importer and reuses the matching shared copy', async () => {
  const { root, profile, plugin } = fixture()
  packageAt(join(plugin, 'node_modules', HELPER), HELPER, 'export const value = 41;')
  const second = '@preview/second'
  const secondDirectory = join(profile, 'node_modules', second)
  packageAt(secondDirectory, second, `export { value } from '${HELPER}';`, { [HELPER]: '2.0.0' })
  packageAt(join(secondDirectory, 'node_modules', HELPER), HELPER, 'export const value = 83;', {}, '2.0.0')
  const result = packVfsImage({
    config: `- name: '${PLUGIN}'\n- name: '${second}'\n`, profile: 'web', workspaces: new Map(),
    resolveFrom: root, rosterResolveFrom: profile, entries: [],
  })
  expect(result.missing).toEqual([])
  expect(result.packages.has(`${second}/node_modules/${HELPER}`)).toBe(true)
  const vfs = loadVfsImage(await inflateImage(result.image, 'two installed dependency copies'), DEFAULT_ROOT)
  const loader = new WorkerModuleLoader({ vfs, root: DEFAULT_ROOT, staticModules: {} })
  const require = loader.requireFrom(DEFAULT_ROOT)
  expect(require(PLUGIN)).toEqual({ answer: 42 })
  expect(require(second)).toEqual({ value: 83 })
  expect(loader.requireFrom(`${DEFAULT_ROOT}/node_modules/${PLUGIN}`)(HELPER)).toBe(require(HELPER))
  expect(loader.requireFrom(`${DEFAULT_ROOT}/node_modules/${second}`)(HELPER)).not.toBe(require(HELPER))
})
