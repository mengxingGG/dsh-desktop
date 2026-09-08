/** Exercises the installed usage plugin across Session cursors and both Fetch carriers. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(new URL('../../../../../../../packages/bundle/web-app/package.json', import.meta.url))
const { collectUsage, apply, USAGE_PATH } = await import(pathToFileURL(require.resolve('@ychris12138/dsh-usage-stats')).href)
const events = []
const reads = []
let revision = 0
let closed = 0
let attached = true
let rejectRead = false
const session = { id: 'usage-compat', get seq() { return events.length }, snapshotEvents: from => events.slice(from) }
const persistence = {
  list: async () => [{ header: { id: session.id }, revision: String(revision), eventCount: events.length }],
  open: async (id, mode) => {
    assert.equal(id, session.id)
    assert.equal(mode, 'read')
    return {
      read: async from => {
        reads.push(from)
        if (rejectRead) throw new Error('read unavailable')
        return { eventState: 'detached', events: events.slice(from) }
      },
      close: async () => { closed++ },
    }
  },
}
const services = { sessions: { list: () => attached ? [session] : [] }, sessionPersistence: persistence }
const warnings = []
const ctx = { get: name => services[name], logger: { warn: message => warnings.push(message) }, effect: register => register() }
function sample(turn, inputTokens) {
  events.push({ seq: events.length, timestamp: Date.now(), type: 'assistant/chunk', data: { turn, step: 1, chunk: { type: 'usage', usage: { inputTokens, outputTokens: 2 } } } })
  revision++
}
sample(1, 10)
assert.equal((await collectUsage(ctx)).total.tokens, 12)
sample(1, 20)
assert.equal((await collectUsage(ctx)).total.tokens, 22)
attached = false
assert.equal((await collectUsage(ctx)).total.tokens, 22)
assert.deepEqual(reads, [0])
assert.equal(closed, 1)
assert.equal((await collectUsage(ctx)).total.tokens, 22)
assert.deepEqual(reads, [0])
sample(2, 5)
assert.equal((await collectUsage(ctx)).total.tokens, 29)
assert.deepEqual(reads, [0, 2])
rejectRead = true
revision++
await assert.rejects(collectUsage(ctx), /read unavailable/)
assert.equal(closed, 3)
rejectRead = false
assert.equal((await collectUsage(ctx)).total.tokens, 29)
assert.equal(closed, 4)
attached = true
assert.equal((await collectUsage(ctx)).total.tokens, 29)

const routes = new Map()
const accounts = { validate: async () => {} }
services.webServer = { register: route => { routes.set(route.path, route); return () => {} } }
await apply(ctx, {}, { accounts, disableBackgroundRefresh: true })
const http = routes.get(USAGE_PATH)
let status
const response = { writeHead: code => { status = code }, end: () => {} }
await http.handler({ method: 'GET', socket: { remoteAddress: '203.0.113.1' }, headers: { host: 'localhost', 'x-forwarded-for': '127.0.0.1' } }, response)
assert.equal(status, 403)
await http.handler({ method: 'POST', socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost' } }, response)
assert.equal(status, 405)
await http.handler({ method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost' } }, response)
assert.equal(status, 200)
delete services.webServer
ctx.connection = { fetch: { register: route => { routes.set(route.path, route); return () => {} } } }
await apply(ctx, {}, { accounts, disableBackgroundRefresh: true })
const privateResponse = await routes.get(USAGE_PATH).fetch(new Request(`dsh-app://app${USAGE_PATH}`))
assert.equal(privateResponse.status, 200)
assert.equal((await privateResponse.json()).total.tokens, 29)
assert.deepEqual(warnings, [])
