import { describe, expect, it, vi } from 'vitest'
import { inspectPlugin, parseRepositoryInput, searchPlugins } from '../src/github.ts'

const options = { maxResults: 8, requestTimeoutMs: 1_000, topic: 'dsh-plugin' }
const repository = (overrides: Record<string, unknown> = {}) => ({
  full_name: 'crazywoola/dsh-balance',
  description: 'Balance bundle',
  html_url: 'https://github.com/crazywoola/dsh-balance',
  default_branch: 'main',
  stargazers_count: 23,
  forks_count: 2,
  license: { spdx_id: 'MIT' },
  updated_at: '2026-08-24T00:00:00Z',
  private: false,
  archived: false,
  disabled: false,
  ...overrides,
})

describe('GitHub marketplace discovery', () => {
  it('accepts exact public repository identities', () => {
    expect(parseRepositoryInput('crazywoola/dsh-balance')).toBe('crazywoola/dsh-balance')
    expect(parseRepositoryInput('https://github.com/crazywoola/dsh-balance.git')).toBe('crazywoola/dsh-balance')
    expect(parseRepositoryInput('http://github.com/crazywoola/dsh-balance')).toBeUndefined()
  })

  it('validates the root bundle manifest and npm package name', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(repository()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: '@pinkbanana/dsh-balance',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }), { status: 200 }))
    await expect(inspectPlugin('crazywoola/dsh-balance', { ...options, fetch: fetchMock }))
      .resolves.toMatchObject({ packageName: '@pinkbanana/dsh-balance', license: 'MIT' })

    const invalidName = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(repository()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: '--dangerous',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }), { status: 200 }))
    await expect(inspectPlugin('crazywoola/dsh-balance', { ...options, fetch: invalidName }))
      .resolves.toBeUndefined()
  })

  it('filters repositories without dsh.bundle', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [repository(), repository({ full_name: 'demo/plain', html_url: 'https://github.com/demo/plain' })],
      }), { status: 200, headers: { 'x-ratelimit-remaining': '12' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: '@pinkbanana/dsh-balance',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'plain' }), { status: 200 }))
    const result = await searchPlugins('balance', { ...options, fetch: fetchMock })
    expect(result.entries.map(entry => entry.repository)).toEqual(['crazywoola/dsh-balance'])
    expect(result.rateLimitRemaining).toBe(12)
    expect(fetchMock.mock.calls[0]?.[0]).toBeInstanceOf(URL)
    expect((fetchMock.mock.calls[0]?.[0] as URL).href).toContain('topic%3Adsh-plugin')
  })
})
