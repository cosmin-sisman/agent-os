// Tests for the Stop reminder on test gaps: named once per set in a session, never a decision that blocks the stop,
// silent with no gaps or no base to diff against, and the runner turning it into a message only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gapsReminder } from './gaps.mjs'
import { runEvent } from './runner.mjs'

const fakeGit = (committed) => (args) => {
  if (args[0] === 'diff' && args[2]?.startsWith('origin/')) return committed === null ? { status: 128, stdout: '', stderr: 'bad revision' } : { status: 0, stdout: committed.join('\n') }
  return { status: 0, stdout: '' }
}
const config = { branches: { integration: 'development' }, testing: { exclude: ['gen/'], map: {} } }

test('given src/a.ts changed and no a.test.ts, the Stop reminder lists it, once per set of gaps', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-gaps-'))
  try {
    const git = fakeGit(['src/a.ts', 'src/b.ts', 'src/b.test.ts', 'gen/api.ts', 'README.md'])
    const first = gapsReminder({ session_id: 's1' }, { config, cwd, git })
    assert.match(first, /1 changed file\(s\) with no changed test: src\/a\.ts\./)
    assert.doesNotMatch(first, /gen\/api|b\.ts/, 'no false warning for excluded or tested files')
    assert.equal(gapsReminder({ session_id: 's1' }, { config, cwd, git }), null, 'the same set is not repeated')
    assert.match(gapsReminder({ session_id: 's1' }, { config, cwd, git: fakeGit(['src/a.ts', 'src/c.ts']) }), /2 changed file/, 'a new set is named')
    assert.match(gapsReminder({ session_id: 's2' }, { config, cwd, git }), /src\/a\.ts/, 'a new session hears it again')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('no gaps, no base to diff, or a stop already continued by a hook: nothing is said', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-gaps-'))
  try {
    assert.equal(gapsReminder({}, { config, cwd, git: fakeGit(['src/a.ts', 'src/a.test.ts']) }), null)
    assert.equal(gapsReminder({}, { config, cwd, git: fakeGit(null) }), null)
    assert.equal(gapsReminder({ stop_hook_active: true }, { config, cwd, git: fakeGit(['src/a.ts']) }), null)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the Stop event only ever warns: a reminder handler cannot block the stop', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-gaps-'))
  try {
    const handlers = [{ name: 'test-gaps', events: ['Stop'], kind: 'reminder', run: () => ({ decision: 'deny', message: 'gaps: src/a.ts' }) }]
    const out = await runEvent('Stop', { session_id: 's' }, { config, cwd, handlers })
    assert.deepEqual(out, { systemMessage: 'gaps: src/a.ts' })
    assert.equal(JSON.stringify(out).includes('block'), false)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
