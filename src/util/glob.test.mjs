// Tests for path globs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matches } from './glob.mjs'

test('globs: **, *, ?, {a,b} and trailing slash', () => {
  assert.ok(matches('docs/reference/a.md', 'docs/**'))
  assert.ok(matches('README.md', '**/*.md'))
  assert.ok(matches('a/b/c.md', '**/*.md'))
  assert.ok(!matches('src/a.mjs', 'docs/**'))
  assert.ok(matches('src/a.mjs', 'src/*.mjs'))
  assert.ok(!matches('src/x/a.mjs', 'src/*.mjs'))
  assert.ok(matches('src/x/a.test.mjs', 'src/**/*.test.mjs'))
  assert.ok(matches('a.yml', '*.{yml,yaml}'))
  assert.ok(matches('db/m/1.sql', 'db/'))
  assert.ok(matches('src\\win\\a.mjs', 'src/**'))
  assert.ok(matches('v1.0.md', 'v?.0.md'))
  assert.ok(!matches('v1x0.md', 'v1.0.md'), 'dots are literal')
})
