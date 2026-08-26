/** Portability checks for dependency links copied into an installer. */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertPortableDependencyLinks } from '../scripts/prepare-installer.ts'

const roots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-links-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('assertPortableDependencyLinks', () => {
  it('accepts links whose targets stay inside the staged runtime', async () => {
    const root = temporaryRoot()
    const target = join(root, 'packages', 'inside')
    mkdirSync(target, { recursive: true })
    symlinkSync(target, join(root, 'inside-link'), process.platform === 'win32' ? 'junction' : 'dir')

    await expect(assertPortableDependencyLinks(root)).resolves.toBeUndefined()
  })

  it('rejects links back to the build checkout or another external directory', async () => {
    const root = temporaryRoot()
    const external = temporaryRoot()
    symlinkSync(external, join(root, 'external-link'), process.platform === 'win32' ? 'junction' : 'dir')

    await expect(assertPortableDependencyLinks(root)).rejects.toThrow('link leaves the deployed runtime')
  })
})
