import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extendWin32ProcessBindings, isNullPtr, type NativePtr } from '@deepseek-ai/dsh-win32-process'
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

    try {
      expect(await (await fetch(backend.url)).text()).toBe('ok')
      const firstStop = backend.stop()
      expect(backend.stop()).toBe(firstStop)
      await firstStop
      const exit = await backend.exited
      expect(exit.error).toBeUndefined()
      expect(exit.exitCode !== null || exit.signal !== null).toBe(true)
    } finally {
      await backend.stop()
    }
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

  it('does not start an already cancelled backend', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-preabort-'))
    const started = join(root, 'started')
    try {
      await expect(startBackend({
        executable: process.execPath,
        argsPrefix: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(started)}, 'started')`],
        signal: AbortSignal.abort(),
      })).rejects.toThrow('startup was cancelled')
      expect(existsSync(started)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform !== 'win32')('stops a detached Windows descendant before returning', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-descendant-'))
    const ready = join(root, 'ready')
    const api = extendWin32ProcessBindings(({ kernel32, bind }) => ({
      openProcess: bind(kernel32, 'OpenProcess', 'void *', ['uint32', 'int', 'uint32']) as
        (access: number, inherit: number, pid: number) => NativePtr | null,
    }))
    let backend: Awaited<ReturnType<typeof startBackend>> | undefined
    let descendant: NativePtr | undefined
    try {
      const child = [
        "const fs = require('node:fs')",
        `fs.writeFileSync(${JSON.stringify(ready)} + '.pending', String(process.pid))`,
        `fs.renameSync(${JSON.stringify(ready)} + '.pending', ${JSON.stringify(ready)})`,
        "process.send('ready')",
        'setInterval(() => {}, 1000)',
      ].join(';')
      const script = [
        "const http = require('node:http')",
        "const server = http.createServer((_request, response) => response.end('ok'))",
        `const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })`,
        "child.once('message', () => { child.disconnect(); child.unref(); server.listen(0, '127.0.0.1', () => console.log(`dsh web: http://127.0.0.1:${server.address().port}`)) })",
      ].join(';')
      backend = await startBackend({ executable: process.execPath, argsPrefix: ['-e', script] })
      const handle = api.openProcess(0x100001, 0, Number(readFileSync(ready, 'utf8')))
      if (isNullPtr(handle)) throw new Error('desktop descendant has no waitable process handle')
      descendant = handle
      expect(api.waitForSingleObject(descendant, 0)).toBe(258)
      await backend.stop()
      expect(api.waitForSingleObject(descendant, 0)).toBe(0)
    } finally {
      // The native handle retains the exact fixture process even after its parent exits.
      if (descendant !== undefined) {
        api.terminateProcess(descendant, 1)
        await expect.poll(() => api.waitForSingleObject(descendant!, 0)).toBe(0)
        api.closeHandle(descendant)
      }
      await backend?.stop()
      rmSync(root, { recursive: true, force: true })
    }
  }, 20_000)
})
