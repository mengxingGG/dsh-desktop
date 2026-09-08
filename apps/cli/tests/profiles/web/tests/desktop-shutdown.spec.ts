/** Real dsh Web-profile IPC shutdown with an isolated user home and durable Session log. */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { startBackend, type BackendHandle } from '../../../../../desktop/src/backend.ts'

const repository = resolve(import.meta.dirname, '../../../../../..')

it.each(['idle', 'busy'] as const)('starts the shipped Web profile and performs %s desktop shutdown through private IPC', { timeout: 90_000 }, async (mode) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-profile-'))
  let backend: BackendHandle | undefined
  try {
    const home = join(root, 'home')
    const profile = join(home, 'profiles', 'web')
    const sessions = join(home, 'sessions')
    const marker = join(root, 'task-running')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      name: 'desktop-profile-fixture', private: true,
      dependencies: { '@deepseek-ai/dsh-web-app': 'workspace:^' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    }))
    await writeFile(join(profile, 'cordis.patch.yml'), [
      '- id: llm-deepseek', '  disabled: true',
      '- id: session-persistence-jsonl', '  config:', `    root: ${JSON.stringify(sessions)}`, '    compression: none',
      '- insert:', '    - id: desktop-task-fixture',
      `      name: ${JSON.stringify(pathToFileURL(join(import.meta.dirname, 'fixtures/desktop-task.mjs')).href)}`,
      '      config:', `        mode: ${mode}`, `        marker: ${JSON.stringify(marker)}`, '',
    ].join('\n'))
    const launch = resolveExampleLaunch({
      srcBin: join(repository, 'apps/cli/src/bin.ts'), tsconfigPath: join(repository, 'tsconfig.json'), sourceImport: 'tsx/esm',
      env: { DSH_HOME: home, DSH_AGENTS_HOME: join(root, 'agents'), DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: '' },
    })
    backend = await startBackend({
      executable: launch.command, argsPrefix: launch.args, environment: { ...process.env, ...launch.env }, cwd: root,
      controlPatch: join(repository, 'packages/bundle/web-app/desktop.patch.yml'), startupTimeoutMs: 60_000,
    })
    if (mode === 'busy') await expect.poll(async () => readFile(marker, 'utf8'), { timeout: 10_000 }).toBe('running')
    expect(await backend.activity()).toBe(mode === 'busy')
    if (mode === 'busy') {
      expect(await backend.shutdown(false)).toBe(false)
      expect(await backend.activity()).toBe(true)
    }
    expect(await backend.shutdown(mode === 'busy')).toBe(true)
    expect((await backend.exited).error).toBeUndefined()
    await expect(fetch(backend.url)).rejects.toThrow()
    if (mode === 'busy') {
      const files = (await readdir(sessions, { recursive: true })).filter(file => file.endsWith('.jsonl'))
      expect(files.length).toBeGreaterThan(0)
      const logs = await Promise.all(files.map(file => readFile(join(sessions, file), 'utf8')))
      const taskLog = logs.find(log => log.includes('desktop-task'))
      expect(taskLog).toContain('Preserve this desktop task')
      const events = taskLog!.trim().split(/\r?\n/).map(line => JSON.parse(line) as unknown)
      expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'disposed' } } } })
    }
  } catch (error) {
    throw new Error(`desktop profile ${mode} failed\n${backend?.logs().replace(/token=[^\s&]+/gu, 'token=<redacted>') ?? ''}`, { cause: error })
  } finally {
    await backend?.stop()
    await rm(root, { recursive: true, force: true })
  }
})
