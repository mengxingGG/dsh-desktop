/** Remote-authority fixtures exercise HTTP trust without an external DNS dependency. */
import { createServer } from 'node:http'
import { expect, it, onTestFinished } from 'vitest'
import { createScaffoldHttpClient } from './scaffold-http.ts'

it('connects locally while preserving the remote Host, request path, and authentication cookie', async () => {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ host: request.headers.host, cookie: request.headers.cookie, url: request.url }))
  })
  onTestFinished(() => new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error) reject(error); else resolve() })
  }))
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Fixture HTTP listener has no TCP address')
  const authority = `remote.invalid:${address.port}`
  const client = createScaffoldHttpClient()
  onTestFinished(() => client.close())
  const response = await client.fetch(`http://${authority}/token?fixture=1`, {
    headers: { cookie: 'fixture=session', host: 'localhost' }, redirect: 'manual',
  })
  expect(await response.json()).toEqual({ host: authority, cookie: 'fixture=session', url: '/token?fixture=1' })
})
