/** Isolated process coverage for the version-pinned Web/Desktop usage plugin patch. */
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { it } from 'vitest'

it('counts live and detached Session tails once, closes read handles, and preserves HTTP caller checks', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-usage-compat-'))
  try {
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./fixtures/usage-compat.mjs', import.meta.url))], {
      env: { ...process.env, DSH_HOME: home }, timeout: 10_000, windowsHide: true,
    })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}, 15_000)
