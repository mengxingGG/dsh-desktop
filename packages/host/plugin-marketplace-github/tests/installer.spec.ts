import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { InspectedPlugin } from '../src/github.ts'
import { installArguments, installPlugin, launcherArgs, scrubEnvironment } from '../src/installer.ts'

const roots: string[] = []
const entry = {
  repository: 'crazywoola/dsh-balance',
  packageName: '@pinkbanana/dsh-balance',
  description: 'Balance bundle',
  htmlUrl: 'https://github.com/crazywoola/dsh-balance',
  defaultBranch: 'main',
  stars: 23,
  forks: 2,
  license: 'MIT',
  updatedAt: '2026-08-24T00:00:00Z',
  installSpec: 'github:crazywoola/dsh-balance',
} as InspectedPlugin

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('marketplace installer', () => {
  it('removes credentials and preserves only launcher-required Node flags', () => {
    expect(scrubEnvironment({
      PATH: 'bin',
      DSH_HOME: 'home',
      DEEPSEEK_API_KEY: 'secret',
      GITHUB_TOKEN: 'token',
    })).toEqual({ PATH: 'bin', DSH_HOME: 'home' })
    expect(launcherArgs(['--inspect=9230', '--expose-internals', '--import', 'tsx/esm', '--loader=custom']))
      .toEqual(['--expose-internals', '--import', 'tsx/esm', '--loader=custom'])
  })

  it('builds one explicit profile mutation', () => {
    const options = {
      execArgv: ['--expose-internals'],
      profile: 'web',
      signal: new AbortController().signal,
      timeoutMs: 5_000,
    }
    expect(installArguments(entry, options, 'dsh.js')).toEqual([
      '--expose-internals',
      'dsh.js',
      'plugin', '--profile', 'web',
      'add', 'github:crazywoola/dsh-balance',
      '--allow-build=@pinkbanana/dsh-balance',
    ])
  })

  it('runs the selected launcher and captures its exit output', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-marketplace-installer-'))
    roots.push(root)
    const launcher = join(root, 'launcher.mjs')
    writeFileSync(launcher, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))\n')

    const result = await installPlugin(entry, {
      executable: process.execPath,
      execArgv: [],
      launcher,
      profile: 'web',
      signal: new AbortController().signal,
      timeoutMs: 5_000,
    })

    expect(result.code).toBe(0)
    expect(JSON.parse(result.output)).toEqual([
      'plugin', '--profile', 'web',
      'add', 'github:crazywoola/dsh-balance',
      '--allow-build=@pinkbanana/dsh-balance',
    ])
  })

  it('cancels a launcher and waits for process exit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-marketplace-cancel-'))
    roots.push(root)
    const launcher = join(root, 'launcher.mjs')
    writeFileSync(launcher, 'setInterval(() => {}, 1_000)\n')
    const controller = new AbortController()
    const installed = installPlugin(entry, {
      executable: process.execPath,
      execArgv: [],
      launcher,
      profile: 'web',
      signal: controller.signal,
      timeoutMs: 5_000,
    })
    setTimeout(() => { controller.abort(new Error('test cancellation')) }, 20)

    await expect(installed).rejects.toThrow('plugin installation was cancelled')
  })
})
