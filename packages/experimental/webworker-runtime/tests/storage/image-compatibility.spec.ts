/** Packed images must match the Worker before module evaluation begins. */
import { expect, it } from 'vitest'
import { DEFAULT_ROOT, IMAGE_MANIFEST_PATH, LOWERING_VERSION } from '../../src/image-layout.ts'
import { requireLoweredImage } from '../../src/storage/image-compatibility.ts'
import { MemoryVfs } from '../../src/storage/memory.ts'

const manifestPath = `${DEFAULT_ROOT}/${IMAGE_MANIFEST_PATH}`

it.each([
  ['flat dependency resolution', { lowered: 'dsh-worker-transform/1' }],
  ['a future transform', { lowered: 'dsh-worker-transform/999' }],
  ['no recorded transform', {}],
] as const)('rejects %s before loading modules', (_description, manifest) => {
  const vfs = new MemoryVfs()
  vfs.seed(manifestPath, JSON.stringify(manifest))
  expect(() => { requireLoweredImage(vfs, manifestPath) }).toThrow('rebuild the image')
})

it('accepts the current wrapper and dependency-resolution version', () => {
  const vfs = new MemoryVfs()
  vfs.seed(manifestPath, JSON.stringify({ lowered: LOWERING_VERSION }))
  expect(() => { requireLoweredImage(vfs, manifestPath) }).not.toThrow()
})

it('requires a readable object manifest', () => {
  const vfs = new MemoryVfs()
  expect(() => { requireLoweredImage(vfs, manifestPath) }).toThrow('is missing')
  vfs.seed(manifestPath, 'null')
  expect(() => { requireLoweredImage(vfs, manifestPath) }).toThrow('does not hold an object')
  vfs.seed(manifestPath, '{')
  expect(() => { requireLoweredImage(vfs, manifestPath) }).toThrow(SyntaxError)
})
