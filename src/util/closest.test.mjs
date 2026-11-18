// Tests for the did-you-mean helpers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { distance, closest } from './closest.mjs'

test('distance counts edits, with an adjacent swap as one', () => {
  assert.equal(distance('host', 'host'), 0)
  assert.equal(distance('hots', 'host'), 1)
  assert.equal(distance('doctr', 'doctor'), 1)
  assert.equal(distance('', 'abc'), 3)
})

test('closest suggests near typos and nothing for unrelated words', () => {
  assert.equal(closest('hots', ['host', 'project', 'type']), 'host')
  assert.equal(closest('Doctor', ['doctor', 'config']), 'doctor')
  assert.equal(closest('zzzzzzzz', ['doctor', 'config']), undefined)
})
