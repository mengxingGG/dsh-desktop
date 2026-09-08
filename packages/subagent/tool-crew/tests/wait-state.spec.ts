/** Manager waiting follows host settlement as well as native worker activity. */

import { describe, expect, it } from 'vitest'
import { expectsSettlingEdge, managerActionReady } from '../src/wait-state.ts'

describe('Crew wait state', () => {
  it.each([undefined, 'passed', 'failed', 'cancelled'] as const)(
    'waits for host integration after the worker stops, with historical result %s',
    (historical) => {
      const view = {
        workItems: [{ stage: 'integration_ready' as const }],
        integrations: [...(historical === undefined ? [] : [{ status: historical }]), { status: 'running' as const }],
      }
      expect(expectsSettlingEdge(view)).toBe(true)
      expect(managerActionReady(view, false)).toBe(false)
      expect(managerActionReady({ ...view, integrations: [{ status: 'passed' }] }, false)).toBe(true)
    },
  )

  it.each(['paused', 'failed'] as const)('offers intervention for %s work even while an integration runs', (stage) => {
    expect(managerActionReady({ workItems: [{ stage }], integrations: [{ status: 'running' }] }, true)).toBe(true)
  })

  it.each(['queued', 'running', 'verifying', 'reviewing', 'revision_required'] as const)(
    'waits across a %s item without inventing manager action',
    (stage) => {
      const view = { workItems: [{ stage }], integrations: [] }
      expect(expectsSettlingEdge(view)).toBe(true)
      expect(managerActionReady(view, false)).toBe(false)
      expect(managerActionReady(view, true)).toBe(false)
    },
  )

  it('offers settled modules only after workers stop and distinguishes an empty workflow', () => {
    const view = {
      workItems: [{ stage: 'integration_ready' }, { stage: 'accepted' }, { stage: 'cancelled' }] as const,
      integrations: [],
    }
    expect(expectsSettlingEdge(view)).toBe(false)
    expect(managerActionReady(view, true)).toBe(false)
    expect(managerActionReady(view, false)).toBe(true)
    expect(managerActionReady({ workItems: [], integrations: [] }, false)).toBe(false)
  })
})
