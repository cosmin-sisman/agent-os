// Tests for version extraction and ranges.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractVersion, satisfies } from './semver.mjs'

test('versions are read from typical --version output', () => {
  assert.deepEqual(extractVersion('gh version 2.46.0 (2024-03-26)'), [2, 46, 0])
  assert.deepEqual(extractVersion('v22.11.0'), [22, 11, 0])
  assert.deepEqual(extractVersion('Docker version 29.9'), [29, 9, 0])
  assert.equal(extractVersion('no version here'), null)
})

test('ranges: any, exact, comparators, caret, tilde and combinations', () => {
  const v = [2, 61, 3]
  for (const [range, ok] of [['*', true], ['2.61.3', true], ['2.61', true], ['2', true], ['2.60', false], ['>=2.60', true], ['>2.61.3', false], ['<3', true], ['<=2.61.2', false],
    ['^2.0', true], ['^3.0', false], ['~2.61.0', true], ['~2.60', false], ['>=2.60 <2.62', true], ['>=2.62 <3', false]]) {
    assert.equal(satisfies(v, range), ok, range)
  }
  assert.equal(satisfies([0, 4, 2], '^0.4.0'), true)
  assert.equal(satisfies([0, 5, 0], '^0.4.0'), false)
  assert.throws(() => satisfies(v, 'latest'), /invalid version range/)
})
