import assert from 'node:assert/strict'
import test from 'node:test'
import { alpha } from '../modules/alpha/index.mjs'
import { beta } from '../modules/beta/index.mjs'

test('combined value', () => { assert.equal(alpha + beta, 43) })
