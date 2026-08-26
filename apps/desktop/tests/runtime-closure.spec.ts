/** Dependency-closure contract of the desktop installer's private deploy root. */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  name?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..')

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), 'utf8')) as PackageManifest
}

function workspacePackages(): Map<string, PackageManifest> {
  const paths = [
    ...globSync('vendor/*/package.json', { cwd: repositoryRoot }),
    ...globSync('packages/*/*/package.json', { cwd: repositoryRoot }),
    ...globSync('apps/*/package.json', { cwd: repositoryRoot }),
    'native/landlock-run/package.json',
    ...globSync('native/landlock-run/packages/*/package.json', { cwd: repositoryRoot }),
  ]
  const packages = new Map<string, PackageManifest>()
  for (const path of paths) {
    const manifest = readManifest(path)
    if (manifest.name !== undefined) packages.set(manifest.name, manifest)
  }
  return packages
}

describe('desktop installer runtime', () => {
  it('makes every required workspace peer reachable from the deploy root', () => {
    const workspace = workspacePackages()
    const runtime = readManifest('apps/desktop/runtime/package.json')
    const runtimeDependencies = runtime.dependencies ?? {}
    const queue = Object.keys(runtimeDependencies).filter(name => workspace.has(name))
    const visited = new Set<string>()
    const missing: string[] = []

    for (let index = 0; index < queue.length; index += 1) {
      const name = queue[index]
      if (name === undefined || visited.has(name)) continue
      visited.add(name)
      const manifest = workspace.get(name)
      if (manifest === undefined) continue
      for (const dependency of Object.keys({
        ...manifest.dependencies,
        ...manifest.optionalDependencies,
      })) {
        if (workspace.has(dependency) && !visited.has(dependency)) queue.push(dependency)
      }
    }

    for (const name of visited) {
      const manifest = workspace.get(name)
      if (manifest === undefined) continue
      for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
        if (!workspace.has(peer) || manifest.peerDependenciesMeta?.[peer]?.optional === true) continue
        if (!visited.has(peer)) missing.push(`${name} -> ${peer}`)
      }
    }

    expect(missing.sort()).toEqual([])
    expect(visited).toContain('@deepseek-ai/dsh')
  })
})
