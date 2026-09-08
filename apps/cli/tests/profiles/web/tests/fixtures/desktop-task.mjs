/** Keyless active-turn fixture mounted only by the desktop profile shutdown smoke. */

import { writeFile } from 'node:fs/promises'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'

class DesktopAdapter extends LlmAdapter {
  constructor(marker) { super(); this.marker = marker }

  async * stream(options) {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'desktop partial response' }
    await writeFile(this.marker, 'running')
    await new Promise((_resolve, reject) => {
      if (options.signal.aborted) { reject(options.signal.reason); return }
      options.signal.addEventListener('abort', () => { reject(options.signal.reason) }, { once: true })
    })
  }
}

/** Fixture plugin identity. */
export const name = 'desktop-task-fixture'
/** The fixture starts through the ordinary Agent and persistence services. */
export const inject = ['agents', 'agentLoop', 'llm', 'sessionPersistence']

/** Start one cancellable turn without network credentials. */
export async function apply(ctx, config) {
  if (config.mode === 'idle') return
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'turn/end') console.error('desktop fixture turn ended:', JSON.stringify(event.data.reason))
  })
  ctx.llm.registerAdapter(['desktop-fixture'], new DesktopAdapter(config.marker))
  const handle = await ctx.agents.create({
    sessionId: 'desktop-task', agentOptions: { provider: 'desktop-fixture', model: 'desktop-fixture' }, meta: { cwd: process.cwd() },
  })
  ctx.effect(() => () => handle.dispose(), 'desktop-fixture.agent')
  handle.agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'Preserve this desktop task when the user confirms exit.' }], source: { kind: 'user' },
  }))
}
