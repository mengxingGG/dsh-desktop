/** Real Desktop Host IPC shutdown with an isolated user home and durable Session log. */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { DesktopHostProcess } from '../../../../../desktop/src/host-process.ts'
import { prepareDevelopmentProject } from '../../../../../desktop/scripts/development-project.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../../../../../desktop/src/host-protocol.ts'

const repository = resolve(import.meta.dirname, '../../../../../..')

it.each(['idle', 'busy'] as const)('starts the private Desktop Host and performs %s desktop shutdown through private IPC', { timeout: 90_000 }, async (mode) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-profile-'))
  let backend: DesktopHostProcess | undefined
  try {
    const home = join(root, 'home')
    const profile = join(home, 'profiles', 'desktop')
    const sessions = join(home, 'sessions')
    const marker = join(root, 'task-running')
    await mkdir(home, { recursive: true })
    const { version } = JSON.parse(await readFile(join(repository, 'apps/cli/package.json'), 'utf8')) as { version: string }
    prepareDevelopmentProject({
      projectDir: profile, cliDir: join(repository, 'apps/cli'), hostDir: join(repository, 'apps/desktop-host'),
      dependencyDir: join(repository, 'node_modules/.pnpm/node_modules'),
      release: { schemaVersion: 1, version, hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION, nodeVersion: process.versions.node, pnpmVersion: '11.7.0' },
    })
    await writeFile(join(profile, 'cordis.patch.yml'), [
      '- id: llm-deepseek', '  disabled: true',
      '- id: session-persistence-jsonl', '  config:', `    root: ${JSON.stringify(sessions)}`, '    compression: none',
      '- insert:', '    - id: desktop-task-fixture',
      `      name: ${JSON.stringify(pathToFileURL(join(import.meta.dirname, 'fixtures/desktop-task.mjs')).href)}`,
      '      config:', `        mode: ${mode}`, `        marker: ${JSON.stringify(marker)}`, '',
    ].join('\n'))
    backend = new DesktopHostProcess(process.execPath, profile, undefined, {
      ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(root, 'agents'), DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: '',
    }, true)
    await backend.start()
    if (mode === 'busy') await expect.poll(async () => readFile(marker, 'utf8'), { timeout: 10_000 }).toBe('running')
    const usage = await backend.fetch(new Request('dsh-app://app/api/usage-stats/usage'))
    expect(usage.status).toBe(200)
    expect(await usage.json()).toMatchObject({ ok: true })
    expect(await backend.activity()).toBe(mode === 'busy')
    if (mode === 'busy') {
      expect(await backend.shutdown(false)).toBe(false)
      expect(await backend.activity()).toBe(true)
    }
    expect(await backend.shutdown(mode === 'busy')).toBe(true)
    await expect(backend.fetch(new Request('dsh-app://app/'))).rejects.toThrow('unavailable')
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
    throw new Error(`desktop profile ${mode} failed`, { cause: error })
  } finally {
    await backend?.stop()
    await rm(root, { recursive: true, force: true })
  }
})
