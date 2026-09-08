/** Windows must not load the POSIX-only native fs-ext binding. */

import { describe, expect, it, vi } from 'vitest'

vi.mock('fs-ext', () => {
  throw new Error('Windows loaded the POSIX-only fs-ext binding')
})

describe.runIf(process.platform === 'win32')('Windows session lease module loading', () => {
  it('loads the Win32 semaphore path without evaluating fs-ext', async () => {
    await expect(import('../src/lease.ts')).resolves.toHaveProperty('SessionWriteLease')
  })
})
