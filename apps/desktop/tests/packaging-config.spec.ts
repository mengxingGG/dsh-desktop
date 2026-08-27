/** Packaging configuration checks shared by every desktop target. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface DesktopManifest {
  build?: {
    executableName?: string
  }
}

describe('desktop packaging configuration', () => {
  it('uses the portable product executable name on every platform', () => {
    const manifestPath = resolve(import.meta.dirname, '..', 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as DesktopManifest

    expect(manifest.build?.executableName).toBe('DeepSeek-Harness')
  })
})
