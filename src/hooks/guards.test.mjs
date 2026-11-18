// Tests for guard rules: splitting command lines, built-in and project rules, inline environment and memory checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitCommands, words, checkCommand, rulesFor, BUILT_IN } from './guards.mjs'

const ids = (line, options = {}) => checkCommand(line, { rules: BUILT_IN, ...options }).map((b) => b.id)

test('command lines split on && || ; | & and newlines, never inside quotes', () => {
  assert.deepEqual(splitCommands('a && b || c; d | e & f\ng "x && y" \'z; w\''), ['a', 'b', 'c', 'd', 'e', 'f', 'g "x && y" \'z; w\''])
  assert.deepEqual(words('git commit -m "a b" \'c d\' -n'), ['git', 'commit', '-m', 'a b', 'c d', '-n'])
})

test('built-in guards refuse skipping git hooks anywhere in a command line', () => {
  assert.deepEqual(ids('git commit --no-verify -m x'), ['no-verify'])
  assert.deepEqual(ids('git add -A && git push --no-verify'), ['no-verify'])
  assert.deepEqual(ids('git commit -n -m x'), ['commit-n'])
  assert.deepEqual(ids('git config core.hooksPath /dev/null'), ['hooks-path'])
  assert.deepEqual(ids('git -c core.hooksPath=/tmp commit -m x'), ['hooks-path'])
})

test('the same words inside a quoted message or another command are fine', () => {
  assert.deepEqual(ids('git commit -m "explain --no-verify in docs"'), [])
  assert.deepEqual(ids('grep -n -- --no-verify README.md'), [])
  assert.deepEqual(ids('git log -n 5'), [])
  assert.deepEqual(ids('npm test'), [])
})

test('require-env accepts the variable inline or in the environment', () => {
  const rules = [{ id: 'db-reset', type: 'require-env', pattern: '^npm\\s+run\\s+db:reset\\b', env: 'DB_RESET_OK' }]
  assert.deepEqual(checkCommand('npm run db:reset', { rules }).map((b) => b.id), ['db-reset'])
  assert.deepEqual(checkCommand('DB_RESET_OK=1 npm run db:reset', { rules }), [])
  assert.deepEqual(checkCommand('npm run db:reset', { rules, env: { DB_RESET_OK: '1' } }), [])
  assert.match(checkCommand('npm run db:reset', { rules })[0].message, /set DB_RESET_OK=1/)
})

test('min-free-memory refuses heavy commands below the floor and names the numbers', () => {
  const rules = [{ id: 'heavy', type: 'min-free-memory', pattern: '^npm\\s+run\\s+build\\b', message: 'builds need memory' }]
  const low = checkCommand('npm run build', { rules, minFreeMb: 1500, freeMb: () => 900 })
  assert.equal(low[0].id, 'heavy')
  assert.match(low[0].message, /only 900 MB free, below the 1500 MB floor/)
  assert.deepEqual(checkCommand('npm run build', { rules, minFreeMb: 1500, freeMb: () => 4000 }), [])
})

test('projects add rules and can disable built-in ones', () => {
  const rules = rulesFor({ guards: { disable: ['commit-n'], rules: [{ id: 'no-rm-rf', type: 'forbid-pattern', pattern: '^rm\\s+-rf\\s+/' }] } })
  assert.deepEqual(rules.map((r) => r.id), ['no-verify', 'hooks-path', 'no-rm-rf'])
  assert.deepEqual(checkCommand('git commit -n -m x && rm -rf /', { rules }).map((b) => b.id), ['no-rm-rf'])
})

test('a rule broken twice in one line is reported once', () => {
  assert.equal(checkCommand('git commit --no-verify && git push --no-verify', { rules: BUILT_IN }).length, 1)
})
