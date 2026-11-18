// Tests for the question helper: answer parsing, defaults, re-asking and giving up.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ask, interpret } from './prompt.mjs'

const io = (answers) => {
  const asked = []
  let err = ''
  return { asked, get err() { return err }, stderr: (s) => { err += s }, ask: async (text) => { asked.push(text); return answers.shift() ?? '' } }
}

test('interpret parses choices, yes/no (en and ro) and bounded integers; empty takes the default', () => {
  const choice = { kind: 'choice', choices: ['en', 'ro'], default: 'en' }
  assert.equal(interpret(choice, 'RO'), 'ro')
  assert.equal(interpret(choice, ''), 'en')
  assert.equal(interpret(choice, 'fr'), undefined)
  const yn = { kind: 'yesno', default: false }
  assert.deepEqual(['y', 'Da', 'no', 'nu', 'maybe'].map((a) => interpret(yn, a)), [true, true, false, false, undefined])
  const n = { kind: 'int', min: 1, max: 10, default: 3 }
  assert.deepEqual(['5', '0', '11', 'x', ''].map((a) => interpret(n, a)), [5, undefined, undefined, undefined, 3])
})

test('ask re-asks on an invalid answer and explains the expected format', async () => {
  const fake = io(['fr', 'ro'])
  assert.equal(await ask(fake, { key: 'c', kind: 'choice', choices: ['en', 'ro'], default: 'en', text: 'Lang?' }), 'ro')
  assert.equal(fake.asked.length, 2)
  assert.match(fake.asked[0], /^Lang\? \(en\/ro, default en\) $/)
  assert.match(fake.err, /please answer en\/ro/)
})

test('ask gives up after three invalid answers', async () => {
  await assert.rejects(ask(io(['a', 'b', 'c']), { key: 'n', kind: 'int', min: 1, default: 1, text: 'N?' }), /no valid answer/)
})

test('without a way to ask, or with useDefaults, the default is used', async () => {
  const q = { key: 'c', kind: 'yesno', default: true, text: 'Ok?' }
  assert.equal(await ask({ stderr() {} }, q), true)
  const fake = io(['n'])
  assert.equal(await ask(fake, q, { useDefaults: true }), true)
  assert.equal(fake.asked.length, 0)
})
