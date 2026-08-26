import { describe, expect, it } from 'vitest'
import { appendBoundedLog, BackendStartupError, parseBackendUrl, startBackend } from '../src/backend.ts'

describe('desktop backend helpers', () => {
  it('accepts only the settled loopback URL line', () => {
    expect(parseBackendUrl('dsh web: http://127.0.0.1:43127')?.href).toBe('http://127.0.0.1:43127/')
    expect(parseBackendUrl('dsh web: http://localhost:43127')).toBeUndefined()
    expect(parseBackendUrl('dsh web: https://127.0.0.1:43127')).toBeUndefined()
    expect(parseBackendUrl('noise http://127.0.0.1:43127')).toBeUndefined()
  })

  it('retains the newest bounded diagnostics', () => {
    expect(appendBoundedLog('1234', '5678', 5)).toBe('45678')
    expect(appendBoundedLog('12', '3', 5)).toBe('123')
  })

  it('starts a loopback backend and waits for shutdown', async () => {
    const script = [
      "const http = require('node:http')",
      "const server = http.createServer((_request, response) => response.end('ok'))",
      "server.listen(0, '127.0.0.1', () => console.log(`dsh web: http://127.0.0.1:${server.address().port}`))",
      "process.on('SIGTERM', () => server.close(() => process.exit(0)))",
    ].join(';')
    const backend = await startBackend({
      executable: process.execPath,
      argsPrefix: ['-e', script],
      startupTimeoutMs: 5_000,
    })

    expect(await (await fetch(backend.url)).text()).toBe('ok')
    await backend.stop()
    const exit = await backend.exited
    expect(exit.error).toBeUndefined()
    expect(exit.exitCode !== null || exit.signal !== null).toBe(true)
  })

  it('reports bounded child diagnostics when startup exits', async () => {
    const start = startBackend({
      executable: process.execPath,
      argsPrefix: ['-e', "process.stderr.write('fixture startup failure'); process.exit(7)"],
      startupTimeoutMs: 5_000,
    })

    const error = await start.catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(BackendStartupError)
    expect((error as BackendStartupError).logs).toContain('fixture startup failure')
  })

  it('cancels a backend that has not reported readiness', async () => {
    const controller = new AbortController()
    const start = startBackend({
      executable: process.execPath,
      argsPrefix: ['-e', 'setInterval(() => {}, 1_000)'],
      signal: controller.signal,
      startupTimeoutMs: 5_000,
    })
    setTimeout(() => { controller.abort() }, 20)

    await expect(start).rejects.toThrow('startup was cancelled')
  })
})
