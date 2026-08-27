/** Packaging configuration checks shared by every desktop target. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { supportsDirectDesktopArtifact } from '../../../scripts/build.ts'

interface DesktopManifest {
  scripts?: Record<string, string>
  build?: {
    executableName?: string
    linux?: unknown
    mac?: unknown
    win?: unknown
  }
}

interface InstallerManifest {
  linux?: unknown
  mac?: unknown
  win?: unknown
}

interface RootManifest {
  scripts?: Record<string, string>
}

describe('desktop packaging configuration', () => {
  it('uses the portable product executable name on supported platforms', () => {
    const manifestPath = resolve(import.meta.dirname, '..', 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as DesktopManifest

    expect(manifest.build?.executableName).toBe('DeepSeek-Harness')
  })

  it('publishes desktop artifacts only for Windows and Linux', () => {
    const appDir = resolve(import.meta.dirname, '..')
    const manifest = JSON.parse(readFileSync(resolve(appDir, 'package.json'), 'utf8')) as DesktopManifest
    const installer = JSON.parse(
      readFileSync(resolve(appDir, 'electron-builder.installer.json'), 'utf8'),
    ) as InstallerManifest
    const root = JSON.parse(readFileSync(resolve(appDir, '..', '..', 'package.json'), 'utf8')) as RootManifest

    expect(typeof manifest.scripts?.['dist:win']).toBe('string')
    expect(typeof manifest.scripts?.['dist:linux']).toBe('string')
    expect(manifest.scripts).not.toHaveProperty('dist:mac')
    expect(manifest.build?.win).toBeDefined()
    expect(manifest.build?.linux).toBeDefined()
    expect(manifest.build).not.toHaveProperty('mac')
    expect(installer.win).toBeDefined()
    expect(installer.linux).toBeDefined()
    expect(installer).not.toHaveProperty('mac')
    expect(typeof root.scripts?.['desktop:dist:win']).toBe('string')
    expect(typeof root.scripts?.['desktop:dist:linux']).toBe('string')
    expect(root.scripts).not.toHaveProperty('desktop:dist:mac')
  })

  it('adds the direct desktop artifact only on supported hosts', () => {
    expect(supportsDirectDesktopArtifact('win32')).toBe(true)
    expect(supportsDirectDesktopArtifact('linux')).toBe(true)
    expect(supportsDirectDesktopArtifact('darwin')).toBe(false)
  })
})
