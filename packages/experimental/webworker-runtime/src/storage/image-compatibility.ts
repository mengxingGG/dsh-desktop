/** Image manifest validation before the Worker evaluates any packed module. */
import { LOWERING_VERSION } from '../image-layout.ts'
import type { MemoryVfs } from './memory.ts'

/**
 * Require an image emitted for this build's wrapper and module-resolution semantics.
 * @param vfs - Mounted filesystem.
 * @param path - Manifest path inside the image.
 * @throws When the manifest is missing, unreadable, or names another version.
 */
export function requireLoweredImage(vfs: MemoryVfs, path: string): void {
  if (!vfs.existsSync(path)) {
    throw new Error(`webworker host: ${path} is missing, so the image records no lowering; rebuild the image`)
  }
  const parsed: unknown = JSON.parse(vfs.readFileSync(path, 'utf8') as string)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`webworker host: ${path} does not hold an object`)
  }
  const lowered = (parsed as { lowered?: unknown }).lowered
  if (lowered !== LOWERING_VERSION) {
    throw new Error(`webworker host: image was lowered by ${String(lowered)}, this build runs ${LOWERING_VERSION}; rebuild the image`)
  }
}
