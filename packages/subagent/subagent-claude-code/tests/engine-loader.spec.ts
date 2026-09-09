import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { startMessagesFixture } from './messages-fixture.ts'

describe('Claude executor public profile', () => {
  it('restores a persisted native conversation after a complete Host restart without Git', async () => {
    const server = await startMessagesFixture({ kind: 'complete', text: 'profile answer' })
    const driver = fileURLToPath(new URL('./fixtures/loader/engine-driver.ts', import.meta.url))
    const patch = fileURLToPath(new URL('./fixtures/loader/engine.patch.yml', import.meta.url))
    try {
      const result = await runLoaderSmoke({ label: 'Claude executor profile restart', tempDirPrefix: 'dsh-claude-profile-',
        binScript: driver, libBinScript: driver, configPath: patch, binArgs: [patch], processTimeoutMs: 60_000,
        tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)),
        env: { DSH_CLAUDE_FIXTURE_URL: server.baseUrl, DEEPSEEK_API_KEY: '' } })
      expect(JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '')).toEqual({ errors: [], bindings: 1, answers: 2, hasGit: false })
      const request = JSON.stringify(server.requests.at(-1)?.body.messages)
      expect(request).toContain('before host restart')
      expect(request).toContain('after host restart')
      expect(server.requests.every(request => request.body.model === 'claude-sonnet-5')).toBe(true)
    } finally { await server.close() }
  }, 75_000)
})
