/** Built composition smoke for the native Crew delivery profile. */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'

const dshBinScript = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const fixturePlugin = pathToFileURL(fileURLToPath(
  new URL('./profiles/headless/tests/fixtures/crew-llm.mjs', import.meta.url),
)).href

function records(content: string): Record<string, unknown>[] {
  return content.split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

async function seedRepository(cwd: string, localOnly: boolean): Promise<void> {
  await Promise.all([
    mkdir(join(cwd, 'modules', 'alpha'), { recursive: true }),
    mkdir(join(cwd, 'modules', 'beta'), { recursive: true }),
    mkdir(join(cwd, 'shared'), { recursive: true }),
    mkdir(join(cwd, 'tests'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(cwd, 'modules', 'alpha', '.gitkeep'), ''),
    writeFile(join(cwd, 'modules', 'beta', '.gitkeep'), ''),
    writeFile(join(cwd, 'shared', 'contract.md'), '# Shared contract\n\nAlpha plus beta must equal 43.\n'),
    writeFile(join(cwd, 'tests', 'integration.test.mjs'), [
      "import assert from 'node:assert/strict'",
      "import test from 'node:test'",
      "import { alpha } from '../modules/alpha/index.mjs'",
      "import { beta } from '../modules/beta/index.mjs'",
      '',
      "test('combined value', () => { assert.equal(alpha + beta, 43) })",
      '',
    ].join('\n')),
  ])
  if (localOnly) return
  git(cwd, ['init', '-b', 'main'])
  git(cwd, ['config', 'user.name', 'Crew Fixture'])
  git(cwd, ['config', 'user.email', 'crew@example.invalid'])
  git(cwd, ['add', '--', 'modules', 'shared', 'tests'])
  git(cwd, ['commit', '-m', 'test: seed native Crew fixture'])
}

describe('dsh native Crew delivery profile', () => {
  it.each([false, true])('runs two native workers, reject/repair, integration, and notification (localOnly=%s)', { timeout: 130_000, retry: 0 }, async (localOnly) => {
    const sandbox = await mkdtemp(join(tmpdir(), 'dsh-crew-native-'))
    const repositoryRoot = join(sandbox, 'repository')
    try {
      const home = join(sandbox, 'home')
      const sessions = join(home, 'sessions')
      const profileDir = join(home, 'profiles', 'crew-native')
      await Promise.all([
        mkdir(profileDir, { recursive: true }),
        mkdir(repositoryRoot, { recursive: true }),
      ])
      await writeFile(join(profileDir, 'package.json'), JSON.stringify({
        name: 'dsh-profile-crew-native',
        private: true,
        dependencies: {
          '@deepseek-ai/dsh-crew-profile': 'workspace:^',
        },
        dsh: {
          profile: {
            bundles: [
              '@deepseek-ai/dsh-base',
              '@deepseek-ai/dsh-headless',
              '@deepseek-ai/dsh-crew-profile',
            ],
          },
        },
      }, undefined, 2) + '\n')
      const sessionRoot = sessions.replaceAll('\\', '/')
      await writeFile(join(profileDir, 'cordis.patch.yml'), [
        '- id: llm-deepseek',
        '  disabled: true',
        '- id: session-persistence-jsonl',
        '  config:',
        `    root: '${sessionRoot}'`,
        '    compression: none',
        '- id: approval',
        '  config:',
        '    policy: ask',
        '- id: crew',
        '  inject: [crewProfilePresets]',
        '  config:',
        '    repositoryRoot: !!js process.cwd()',
        '    nativeProvider: spawn',
        '    maxConcurrentWorkers: 4',
        '    notificationBatchWindowMs: 20',
        '    workerTurnTimeoutMs: 900000',
        '    maxAutomaticRepairs: 1',
        '    maxReviewRounds: 2',
        '    allowedTestPrograms: [pnpm, npm, node]',
        '    commitPolicy:',
        '      maxMessageLength: 200',
        '      requireNamedBranch: true',
        '    roles: !!js ctx.crewProfilePresets.workerRoles',
        '- insert:',
        '    - id: crew-fixture-llm',
        `      name: '${fixturePlugin}'`,
        '',
      ].join('\n'))
      await seedRepository(repositoryRoot, localOnly)
      const launch = resolveExampleLaunch({
        srcBin: dshBinScript,
        configArgs: ['--profile', 'crew-native', `Use the native Crew to implement the two frozen modules and complete the verified local workflow.${localOnly ? ' Develop locally without Git or a commit.' : ''}`],
        tsconfigPath,
        env: {
          DSH_HOME: home,
          DSH_AGENTS_HOME: join(sandbox, 'agents'),
          DSH_PERMISSION_MODE: 'workspace-write',
          DSH_TELEMETRY_DISABLED: '1',
          DEEPSEEK_API_KEY: '',
          NODE_OPTIONS: [
            process.env.NODE_OPTIONS,
            '--disable-warning=ExperimentalWarning',
            '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
          ].filter(Boolean).join(' '),
        },
      })
      const result = await execa(launch.command, launch.args, {
        cwd: repositoryRoot,
        env: launch.env,
        input: '',
        timeout: 120_000,
        killSignal: 'SIGKILL',
        reject: false,
      })
      expect(result.timedOut, 'The native Crew CLI exceeded its process deadline').toBe(false)
      expect(result.signal, 'The native Crew CLI was terminated by a signal').toBeUndefined()
      expect(
        result.exitCode,
        `dsh crew-native profile exited unexpectedly.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      ).toBe(0)
      expect(result.stderr).toBe('')
      const files = (await readdir(sessions, { recursive: true })).filter(file => file.endsWith('.jsonl'))
      const logs = await Promise.all(files.map(file => readFile(join(sessions, file), 'utf8')))
      const parsed = logs.map(records)
      expect(files, JSON.stringify({
        stdout: result.stdout,
        workflow: parsed.flat().filter(event => event.type === 'crew/verification' || event.type === 'crew/report'),
        sessions: parsed.map(log => ({ header: log[0], events: log.filter(event =>
          String(event.type).startsWith('crew/') || event.type === 'tool/result' || event.type === 'turn/end').slice(-12) })),
      }))
        .toHaveLength(7)
      const root = parsed.find((log) => {
        const header = log[0]
        return header?.type === 'session' && typeof header.parentSession !== 'string'
      })
      expect(root).toBeDefined()
      const crewEvents = root!.filter(record => typeof record.type === 'string' && record.type.startsWith('crew/'))
      const recentCrew = crewEvents.slice(-12).map((record) => {
        const data = record.data as Record<string, unknown>
        const value = (data.workItem ?? data.integration ?? data.notification ?? data) as Record<string, unknown>
        return { type: record.type, stage: value.stage, status: value.status, summary: value.summary, commands: value.commands }
      })
      expect(result.stdout, JSON.stringify(recentCrew)).toContain('CREW_NATIVE_WORKFLOW_OK')
      expect(crewEvents.filter(record => record.type === 'crew/review').map((record) => {
        const data = record.data as { review?: { verdict?: string } } | undefined
        return data?.review?.verdict
      })).toEqual(expect.arrayContaining(['rejected', 'passed', 'passed']))
      expect(crewEvents.some((record) => {
        const data = record.data as { integration?: { status?: string } } | undefined
        return record.type === 'crew/integration' && data?.integration?.status === 'passed'
      })).toBe(true)
      expect(crewEvents.some((record) => {
        const data = record.data as { notification?: { status?: string } } | undefined
        return record.type === 'crew/notification' && data?.notification?.status === 'delivered'
      })).toBe(true)
      expect(crewEvents.some((record) => {
        const data = record.data as { commit?: { status?: string } } | undefined
        return record.type === 'crew/commit' && data?.commit?.status === 'committed'
      })).toBe(!localOnly)

      expect(await readFile(join(repositoryRoot, 'modules', 'alpha', 'index.mjs'), 'utf8')).toBe('export const alpha = 41\n')
      expect(await readFile(join(repositoryRoot, 'modules', 'beta', 'index.mjs'), 'utf8')).toBe('export const beta = 2\n')
      if (localOnly) {
        expect(existsSync(join(repositoryRoot, '.git'))).toBe(false)
        expect(crewEvents.some(record => record.type === 'crew/commit')).toBe(false)
        const baselines = crewEvents.filter(record => record.type === 'crew/work-item').map(record => (
          (record.data as { workItem: { baseline: { head: unknown } } }).workItem.baseline.head
        ))
        expect(baselines.length).toBeGreaterThan(0)
        expect(baselines.every(head => head === null)).toBe(true)
        return
      }
      expect(git(repositoryRoot, ['rev-list', '--count', 'HEAD']).trim()).toBe('2')
      expect(git(repositoryRoot, ['show', '--pretty=format:', '--name-only', 'HEAD']).trim().split(/\r?\n/u).sort()).toEqual([
        'modules/alpha/index.mjs',
        'modules/beta/index.mjs',
      ])
      expect(git(repositoryRoot, ['remote']).trim()).toBe('')
      expect(git(repositoryRoot, ['status', '--short', '--untracked-files=all']).trim().split(/\r?\n/u).sort()).toEqual([
        '?? specs/alpha-v1.md',
        '?? specs/beta-v1.md',
      ])
    } finally {
      await rm(sandbox, { recursive: true, force: true })
    }
  })
})
