import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PluginMarketplaceGateway from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  delete process.env.MARKETPLACE_TEST_TOKEN
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('PluginMarketplaceGateway', () => {
  it('publishes search and add under the pluginMarketplace namespace', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(PluginMarketplaceGateway).await()
    const marketplace = ctx.get('pluginMarketplace') as PluginMarketplaceGateway

    expect(marketplace.typertRemote).toMatchObject({
      serviceKey: 'pluginMarketplace',
      namespace: 'pluginMarketplace',
    })
    expect(remoteMethods(marketplace)).toEqual([
      { method: 'search', invocation: { kind: 'direct' } },
      { method: 'add', invocation: { kind: 'direct' } },
    ])
  })

  it('resolves tokenEnv defaults before issuing a GitHub request', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
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
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: '@pinkbanana/dsh-balance',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    process.env.MARKETPLACE_TEST_TOKEN = 'test-token'
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(PluginMarketplaceGateway, { tokenEnv: 'MARKETPLACE_TEST_TOKEN' }).await()
    const marketplace = ctx.get('pluginMarketplace') as PluginMarketplaceGateway

    await expect(marketplace.search({ query: 'crazywoola/dsh-balance' }))
      .resolves.toMatchObject({ entries: [{ packageName: '@pinkbanana/dsh-balance' }] })
    const request = fetchMock.mock.calls[0]?.[1]
    expect(request?.headers).toMatchObject({ authorization: 'Bearer test-token' })
  })
})
