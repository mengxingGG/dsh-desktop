import assert from 'node:assert/strict'
import test from 'node:test'
import { greeting } from '../modules/greeting/index.mjs'

test('greeting follows the shared contract', () => {
  assert.equal(greeting('Crew'), 'Hello, Crew!')
})
