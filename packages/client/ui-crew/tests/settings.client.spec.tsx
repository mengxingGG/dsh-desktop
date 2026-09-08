// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CrewMemoryId, CrewPreferencesValue } from '@deepseek-ai/dsh-crew/client'
import { CrewSettings, type CrewSettingsProps } from '../src/client/CrewSettings.tsx'
import { CrewSettingsController } from '../src/client/preferences.ts'
import { en, zh, type CrewKey } from '../src/client/locales.ts'
import { catalog, preferencesFixture } from './preferences.fixture.client.ts'

const ID = 'test-habit' as CrewMemoryId

function setup(value?: CrewPreferencesValue, dictionary = en) {
  const fixture = preferencesFixture(value)
  const controller = new CrewSettingsController(fixture.scope, async () => catalog)
  controller.catalog.set({ status: 'ready', value: catalog })
  const face = controller.inject()
  const props: CrewSettingsProps = {
    ...face,
    usePreferences: selector => selector(fixture.store.getSnapshot()),
    useCatalog: selector => selector(controller.catalog.getSnapshot()),
    t: key => dictionary[key as CrewKey],
    loadCatalog: vi.fn(),
  }
  return { ...fixture, props, controller }
}

function memoryValue(): CrewPreferencesValue {
  return {
    roles: { manager: {}, developer: {}, reviewer: {}, integrator: {} },
    memory: { [ID]: { kind: 'preference', text: 'Usually approve unit tests.', scope: 'All projects' } },
  }
}

afterEach(cleanup)

describe('Crew global settings UI', () => {
  it.each([{ dictionary: en }, { dictionary: zh }])('shows the four independent roles and DSH-global storage in both locales', ({ dictionary }) => {
    const fixture = setup(undefined, dictionary)
    render(<CrewSettings {...fixture.props} />)
    expect(screen.getByText(dictionary.settingsGlobal)).toBeTruthy()
    expect(screen.getByText(dictionary.settingsMemoryHelp)).toBeTruthy()
    for (const role of ['manager', 'developer', 'reviewer', 'integrator'] as const) {
      expect(screen.getByLabelText(`${dictionary[role]} · ${dictionary.settingsModel}`)).toBeTruthy()
    }
    expect(fixture.props.loadCatalog).toHaveBeenCalledOnce()
    fixture.controller.dispose()
  })

  it('updates only the chosen role and clears incompatible reasoning when its model changes', async () => {
    const fixture = setup()
    const view = render(<CrewSettings {...fixture.props} />)
    fireEvent.change(screen.getByLabelText(`${en.developer} · ${en.settingsModel}`), { target: { value: JSON.stringify(['mock', 'reasoner']) } })
    await screen.findByText(en.settingsSaved)
    view.rerender(<CrewSettings {...fixture.props} />)
    fireEvent.change(screen.getByLabelText(`${en.developer} · ${en.settingsReasoning}`), { target: { value: 'high' } })
    await waitFor(() => { expect(fixture.scope.getSnapshot().value?.roles.developer.reasoningEffort).toBe('high') })
    view.rerender(<CrewSettings {...fixture.props} />)
    fireEvent.change(screen.getByLabelText(`${en.developer} · ${en.settingsModel}`), { target: { value: JSON.stringify(['mock', 'general']) } })
    await waitFor(() => { expect(fixture.scope.getSnapshot().value?.roles.developer).toEqual({ provider: 'mock', model: 'general' }) })
    expect(fixture.scope.getSnapshot().value?.roles.manager).toEqual({})
    fixture.controller.dispose()
  })

  it('retains disappeared routes without substituting another model and allows reverting to inheritance', async () => {
    const value: CrewPreferencesValue = {
      ...memoryValue(), roles: { ...memoryValue().roles, reviewer: { provider: 'missing', model: 'old-model' } },
    }
    const fixture = setup(value)
    render(<CrewSettings {...fixture.props} />)
    expect(screen.getByRole('option', { name: `missing / old-model · ${en.settingsModelUnavailable}` })).toBeTruthy()
    fireEvent.change(screen.getByLabelText(`${en.reviewer} · ${en.settingsModel}`), { target: { value: '' } })
    await screen.findByText(en.settingsSaved)
    expect(fixture.scope.getSnapshot().value?.roles.reviewer).toEqual({})
    fixture.controller.dispose()
  })

  it('edits memory through DSH settings and preserves an old draft when another window changes it', async () => {
    const fixture = setup(memoryValue())
    const view = render(<CrewSettings {...fixture.props} />)
    fireEvent.click(screen.getByRole('button', { name: en.settingsEdit }))
    fireEvent.change(screen.getByLabelText(en.settingsMemoryText), { target: { value: 'Explain dependency installation first.' } })
    const newer: CrewPreferencesValue = {
      ...memoryValue(), memory: { [ID]: { kind: 'preference', text: 'Do not automatically delete files.', scope: 'All projects' } },
    }
    fixture.store.set({ ...fixture.store.getSnapshot(), value: newer, revision: 2 })
    view.rerender(<CrewSettings {...fixture.props} />)
    fireEvent.click(screen.getByRole('button', { name: en.settingsSave }))
    await screen.findByText(en.settingsSaveFailed)
    expect(fixture.scope.getSnapshot().value?.memory[ID]?.text).toBe('Do not automatically delete files.')
    expect(screen.getByLabelText<HTMLTextAreaElement>(en.settingsMemoryText).value).toBe('Explain dependency installation first.')
    fireEvent.click(screen.getByRole('button', { name: en.settingsCancel }))
    fireEvent.click(screen.getByRole('button', { name: en.settingsEdit }))
    fireEvent.change(screen.getByLabelText(en.settingsMemoryText), { target: { value: 'Explain dependency installation first.' } })
    fireEvent.click(screen.getByRole('button', { name: en.settingsSave }))
    await screen.findByText(en.settingsSaved)
    expect(fixture.scope.getSnapshot().value?.memory[ID]?.text).toBe('Explain dependency installation first.')
    fixture.controller.dispose()
  })

  it('requires an explicit authorization save and does not silently turn a preference into permission', async () => {
    const fixture = setup()
    render(<CrewSettings {...fixture.props} />)
    fireEvent.click(screen.getByRole('button', { name: en.settingsAddMemory }))
    expect(screen.getByLabelText<HTMLSelectElement>(en.settingsKind).value).toBe('preference')
    fireEvent.change(screen.getByLabelText(en.settingsKind), { target: { value: 'authorization' } })
    expect(screen.getByText(en.settingsAuthorizationHelp)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(en.settingsMemoryText), { target: { value: 'Run unit tests without asking each time.' } })
    fireEvent.change(screen.getByLabelText(en.settingsScope), { target: { value: 'Unit tests only, not dependency installation.' } })
    expect(fixture.mutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.settingsSaveAuthorization }))
    await screen.findByText(en.settingsSaved)
    expect(Object.values(fixture.scope.getSnapshot().value!.memory)).toEqual([{
      kind: 'authorization', text: 'Run unit tests without asking each time.', scope: 'Unit tests only, not dependency installation.',
    }])
    fixture.controller.dispose()
  })

  it('cancels or confirms removal without touching unrelated settings', async () => {
    const fixture = setup(memoryValue())
    render(<CrewSettings {...fixture.props} />)
    fireEvent.click(screen.getByRole('button', { name: en.settingsDelete }))
    fireEvent.click(within(screen.getByRole('group', { name: en.settingsDeleteConfirm })).getByRole('button', { name: en.settingsCancel }))
    expect(fixture.mutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.settingsDelete }))
    fireEvent.click(screen.getByRole('button', { name: en.settingsConfirmDelete }))
    await screen.findByText(en.settingsSaved)
    expect(fixture.scope.getSnapshot().value?.memory).toEqual({})
    expect(fixture.scope.getSnapshot().value?.roles.integrator).toEqual({})
    fixture.controller.dispose()
  })

  it('does not offer writable controls for disconnected or browser-local preferences', () => {
    const fixture = setup(memoryValue())
    fixture.store.set({ ...fixture.store.getSnapshot(), mode: 'memory', status: 'unavailable' })
    render(<CrewSettings {...fixture.props} />)
    expect(screen.getByText(en.settingsReadOnly)).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.settingsAddMemory }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.settingsEdit }).disabled).toBe(true)
    fixture.controller.dispose()
  })
})
