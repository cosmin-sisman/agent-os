// Tests for the three-way merge.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { merge3 } from './merge3.mjs'

const base = 'one\ntwo\nthree\nfour\nfive\n'

test('changes to different lines are both kept', () => {
  assert.deepEqual(merge3(base, 'one\nTWO local\nthree\nfour\nfive\n', 'one\ntwo\nthree\nfour\nFIVE new\n'), { text: 'one\nTWO local\nthree\nfour\nFIVE new\n', conflicts: 0 })
})

test('additions at both ends, deletions and identical changes merge cleanly', () => {
  assert.equal(merge3(base, `top local\n${base}`, `${base}bottom new\n`).text, `top local\n${base}bottom new\n`)
  assert.equal(merge3(base, base, 'one\nthree\nfour\nfive\n').text, 'one\nthree\nfour\nfive\n')
  assert.deepEqual(merge3(base, 'one\nsame\nthree\nfour\nfive\n', 'one\nsame\nthree\nfour\nfive\n'), { text: 'one\nsame\nthree\nfour\nfive\n', conflicts: 0 })
})

test('when only one side changed, that side wins', () => {
  assert.equal(merge3(base, base, 'x\n').text, 'x\n')
  assert.equal(merge3(base, 'y\n', base).text, 'y\n')
})

test('different changes to the same lines conflict, with labelled markers', () => {
  const r = merge3(base, 'one\nmine\nthree\nfour\nfive\n', 'one\ntheirs\nthree\nfour\nfive\n', { theirsLabel: 'agent-os 0.2.0' })
  assert.equal(r.conflicts, 1)
  assert.equal(r.text, 'one\n<<<<<<< local\nmine\n=======\ntheirs\n>>>>>>> agent-os 0.2.0\nthree\nfour\nfive\n')
})

test('CRLF input merges like LF input', () => {
  assert.equal(merge3(base.replace(/\n/g, '\r\n'), 'one\r\nTWO\r\nthree\r\nfour\r\nfive\r\n', base).text, 'one\nTWO\nthree\nfour\nfive\n')
})

test('an empty base with equal sides is clean, with different sides is a conflict', () => {
  assert.equal(merge3('', 'x\n', 'x\n').conflicts, 0)
  assert.equal(merge3('', 'x\n', 'y\n').conflicts, 1)
})
