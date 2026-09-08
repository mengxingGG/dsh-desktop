import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const [repositoryArg, sessionsArg, transcriptArg, elapsedSeconds, testIsolation = 'process'] = process.argv.slice(2)
assert(repositoryArg && sessionsArg && transcriptArg && elapsedSeconds, 'Expected repository, sessions, transcript, and elapsed seconds')
assert(['process', 'none'].includes(testIsolation), 'Expected process or none for test isolation')
const repository = resolve(repositoryArg)
const sessions = resolve(sessionsArg)
const transcriptPath = resolve(transcriptArg)

function checked(program, args, cwd) {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, `${program} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`)
  return result.stdout.trim()
}

function parseLog(content) {
  return content.split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line))
}

const relativeLogs = (await readdir(sessions, { recursive: true }))
  .filter(path => path.endsWith('.jsonl'))
assert(relativeLogs.length >= 4, `Expected a manager and three worker Session logs, received ${relativeLogs.length}`)

const logs = await Promise.all(relativeLogs.map(async path => parseLog(await readFile(join(sessions, path), 'utf8'))))
const manager = logs.find(log => log[0]?.type === 'session' && log[0]?.parentSession === undefined)
assert(manager, 'Manager Session log was not found')
const childCount = logs.filter(log => typeof log[0]?.parentSession === 'string').length
assert(childCount >= 3, `Expected developer, reviewer, and integrator Sessions, received ${childCount}`)

const crewEvents = manager.filter(event => typeof event.type === 'string' && event.type.startsWith('crew/'))
assert(crewEvents.some(event => event.type === 'crew/configuration'), 'Crew configuration was not persisted')
assert(crewEvents.some(event => event.type === 'crew/verification' && event.data?.verification?.verdict === 'passed'), 'Host verification did not pass')
assert(crewEvents.some(event => event.type === 'crew/review' && event.data?.review?.verdict === 'passed'), 'Independent review did not pass')
assert(crewEvents.some(event => event.type === 'crew/integration' && event.data?.integration?.status === 'passed'), 'Integration did not pass')
const passingIntegration = crewEvents.findLast(event => event.type === 'crew/integration' && event.data?.integration?.status === 'passed').data.integration
assert.deepEqual(passingIntegration.testCommands.map(command => command.argv), [[
  'node', ...(testIsolation === 'none' ? ['--test-isolation=none'] : []), '--test', 'integration.test.mjs',
]], 'The declared integration command differs from the requested smoke coverage')
assert.equal(passingIntegration.commands.length, 1, 'Expected one executed host integration command')
assert(passingIntegration.commands.every(command => command.exitCode === 0 && !command.timedOut), 'The host integration command failed')
assert(crewEvents.some(event => event.type === 'crew/work-item' && event.data?.workItem?.stage === 'accepted'), 'Integrated work item was not accepted')
assert(crewEvents.some(event => event.type === 'crew/notification'), 'No durable manager notification was recorded')
assert(!crewEvents.some(event => event.type === 'crew/commit'), 'The unattended real-provider smoke must not request a commit')

const implementation = await readFile(join(repository, 'modules', 'greeting', 'index.mjs'), 'utf8')
assert(implementation.length > 0, 'The greeting implementation is empty')
checked('node', ['--test', 'integration.test.mjs'], join(repository, 'tests'))
assert.equal(checked('git', ['rev-list', '--count', 'HEAD'], repository), '1', 'The smoke unexpectedly created a commit')
assert.deepEqual(
  checked('git', ['status', '--short', '--untracked-files=all'], repository).split(/\r?\n/u).filter(Boolean).sort(),
  ['?? modules/greeting/index.mjs', '?? specs/greeting-v1.md'],
  'The real model changed files outside the declared workflow outputs',
)

const transcript = await readFile(transcriptPath, 'utf8')
assert.match(transcript, /CREW_REAL_API_OK/u, 'The manager did not emit the success marker')

const result = {
  provider: 'deepseek-official',
  testIsolation,
  executionCoverage: testIsolation === 'none' ? 'single-process-only' : 'test-runner-child-processes',
  elapsedSeconds: Number(elapsedSeconds),
  sessionLogs: relativeLogs.length,
  childSessions: childCount,
  crewEventCount: crewEvents.length,
  hostVerification: 'passed',
  review: 'passed',
  integration: 'passed',
  commitRequested: false,
  changedPaths: ['modules/greeting/index.mjs', 'specs/greeting-v1.md'],
}
await writeFile(join(dirname(repository), 'verification.json'), `${JSON.stringify(result, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(result)}\n`)
