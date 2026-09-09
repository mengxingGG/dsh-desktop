import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { ClaudeOperations } from '../src/engine-lifecycle.ts'
import { ClaudeLogin } from '../src/engine-login.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

async function harness(script: string) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalSubprocessRuntime)
  const operations = new ClaudeOperations(ctx)
  const login = new ClaudeLogin()
  const spawn = vi.fn((spec: SubprocessSpawnSpec) => ctx.subprocess.spawn(spec))
  const spec: SubprocessSpawnSpec = { argv: [process.execPath, '-e', script], cwd: process.cwd(), graceMs: 1000,
    stdio: { stdin: 'pipe', stdout: { maxBytes: 128 }, stderr: { maxBytes: 128 } } }
  return { ctx, operations, login, spawn, spec }
}

describe('native login process ownership', () => {
  it('reports a cleanup failure instead of leaving completed authorization running', async () => {
    const { operations, login, spec, ctx } = await harness('process.exit(0)')
    const start = (input: SubprocessSpawnSpec) => {
      const child = ctx.subprocess.spawn(input)
      return { ...child, waitForExit: async () => { await child.waitForExit(); throw new Error('cleanup failed') } }
    }
    await login.start(operations, start, spec, 10_000)
    await vi.waitFor(() =>{  expect(login.snapshot()?.status).toBe('failed') })
    expect(login.snapshot()?.error).toBe('cleanup failed')
  })

  it('shares concurrent starts and forwards one response without retaining the code', async () => {
    const { operations, login, spawn, spec } = await harness("process.stdout.write('authorize in browser');process.stdin.once('data',()=>{process.stdout.write(' completed');process.exit(0)})")
    const [one, two] = await Promise.all([login.start(operations, spawn, spec, 10_000), login.start(operations, spawn, spec, 10_000)])
    expect(one.id).toBe(two.id)
    expect(spawn).toHaveBeenCalledTimes(1)
    await vi.waitFor(() =>{  expect(login.snapshot()?.output).toContain('authorize') })
    await expect(login.input(one.id, 'one\ntwo')).rejects.toThrow('one nonempty response line')
    await login.input(one.id, 'private-code')
    await vi.waitFor(() =>{  expect(login.snapshot()?.status).toBe('completed') })
    expect(login.snapshot()?.output).toContain('completed')
    expect(JSON.stringify(login.snapshot())).not.toContain('private-code')
    await expect(login.input(one.id, 'late')).rejects.toThrow('no longer running')
  })

  it('bounds progress output and drains an active login on plugin disposal', async () => {
    const { ctx, operations, login, spawn, spec } = await harness("process.stdout.write('x'.repeat(1000));process.stdin.resume()")
    await login.start(operations, spawn, spec, 10_000)
    await vi.waitFor(() =>{  expect(login.snapshot()?.truncated).toBe(true) })
    expect(login.snapshot()?.output.length).toBeLessThanOrEqual(128)
    await ctx.fiber.dispose()
    expect(login.snapshot()?.status).toBe('cancelled')
    await expect(login.start(operations, spawn, spec, 10_000)).rejects.toThrow('unloaded')
  })
})
