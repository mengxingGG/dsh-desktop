/** Native protocol rejection and accounting cases; no CLI process is started. */
import { describe, expect, it } from 'vitest'
import { parseModels, parseQuota, parseResponse, usageSample } from '../src/protocol.ts'

describe('native CLI response admission', () => {
  const tools = [{ name: 'crew_read_file', description: 'Read an assigned file.', parameters: { type: 'object' as const } }]
  it('rejects tools outside the advertised role before dispatch', () => {
    expect(() => parseResponse({ text: '', calls: [{ name: 'spawn_agent', arguments: '{}' }] }, tools)).toThrow('unavailable')
    expect(() => parseResponse({ text: '', calls: [{ name: 'crew_read_file', arguments: '[]' }] }, tools)).toThrow('object')
  })
  it('keeps valid calls available for the DSH permission path', () => {
    expect(parseResponse({ text: '', calls: [{ name: 'crew_read_file', arguments: '{"path":"src/main.ts"}' }] }, tools).calls).toHaveLength(1)
  })
  it('separates auxiliary Grok authentication diagnostics from model identities', () => {
    expect(parseModels('grok-cli', 'You are not authenticated.\nAvailable models:\n * grok-4.6 (default)\n - grok-4.5\n')).toEqual([
      { id: 'grok-4.6', name: 'grok-4.6' }, { id: 'grok-4.5', name: 'grok-4.5' },
    ])
  })
  it('converts native remaining quota without estimating from cost', () => {
    expect(parseQuota('Gemini Models  Weekly Limit Remaining  97%  2026-09-12T12:26:04Z')[0]?.usedPercent).toBe(3)
    expect(() => parseQuota('Estimated balance: $5')).toThrow('native quota')
  })
  it('differences Antigravity cumulative counters and leaves reset counters unknown', () => {
    const sample = usageSample('antigravity-cli', 'model', { input_tokens: 120, output_tokens: 3 }, { input_tokens: 100, output_tokens: 5 }, null)
    expect(sample).toMatchObject({ inputTokens: 20, outputTokens: null, contextWindow: null, contextTokens: null, costUsd: null })
  })
})
