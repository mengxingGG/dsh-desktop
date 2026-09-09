/** Public profile execution and Session reconstruction using the real native CLI. */

import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent-claude-code/engine'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const patch = process.argv[2]
if (patch === undefined) throw new Error('Claude engine fixture requires its profile patch')
process.env.DSH_CLAUDE_FIXTURE_HOME = join(process.cwd(), '.claude-fixture')
await mkdir(process.env.DSH_CLAUDE_FIXTURE_HOME, { recursive: true })
const errors: string[] = []
const boot = () => bootProductionProfile({ profile: 'headless', binName: 'claude-engine-test', overlayPaths: [patch],
  prepare: (ctx) => { ctx.on('agent/error', ({ error }) => { errors.push(String(error)) }) } })
let ctx = await boot()
const id = SessionId('claude-loader-resume')
const options = { provider: 'claude-code', model: 'claude-sonnet-5', reasoningEffort: ReasoningEffortId('low') }
const prompt = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
try {
  const first = await ctx.agents.create({ sessionId: id, meta: { cwd: process.cwd() }, agentOptions: options })
  first.agent.followup(prompt('before host restart'))
  await first.agent.whenIdle()
  await ctx.sessions.flush(first.agent.session)
  await first.dispose()
  await ctx.fiber.dispose()
  ctx = await boot()
  const second = await ctx.agents.resume({ resumeSessionId: id, agentOptions: options })
  second.agent.followup(prompt('after host restart'))
  await second.agent.whenIdle()
  await ctx.sessions.flush(second.agent.session)
  const events = second.agent.session.snapshotEvents()
  process.stdout.write(JSON.stringify({ errors, bindings: events.filter(event => event.type === 'claude-code/binding').length,
    answers: events.filter(event => event.type === 'assistant/message').length,
    hasGit: existsSync(join(process.cwd(), '.git')) }) + '\n')
  await second.dispose()
} finally { await ctx.fiber.dispose() }
