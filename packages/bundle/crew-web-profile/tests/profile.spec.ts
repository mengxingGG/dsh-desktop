/** The Crew Web bundle adds the orchestration preset beside the ordinary catalog. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('native Crew Web profile bundle', () => {
  it('ships the Crew UI and publishes the orchestration preset as a system root', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      private?: boolean
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.private).toBeUndefined()
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toEqual({
      '@deepseek-ai/dsh-client-ui-crew': 'workspace:^',
      '@deepseek-ai/dsh-crew-profile': 'workspace:^',
    })
    const parsed = yaml.load(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'), {
      schema: entryListSchema,
    }) as {
      id?: string
      inject?: string[]
      config?: Record<string, unknown>
      insert?: { id?: string; name?: string }[]
    }[]
    // The roster row is patched, not inserted: `dsh-web-app` owns it, and this
    // layer only appends the Crew orchestration preset as a second read-only
    // root. `default` stays `standard`, so selecting orchestration remains the
    // user's per-session choice.
    const roster = parsed.find(row => row.id === 'agent-presets')
    expect(roster?.inject).toEqual(['crewProfilePresets'])
    expect(roster?.config).toEqual({
      default: 'standard',
      roots: { __jsExpr: 'ctx.crewProfilePresets.agentPresetRoots' },
    })
    expect(parsed.flatMap(row => row.insert ?? [])).toEqual([
      { id: 'ui-crew', name: '@deepseek-ai/dsh-client-ui-crew' },
    ])
  })
})
