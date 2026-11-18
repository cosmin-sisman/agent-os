// Tests for managed files: install, update of unmodified and edited items, conflicts to .rej, Markdown blocks,
// settings.json hooks, eject and relock.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyManaged, exitCodeFor, readLock, eject, relock, readBlock, writeBlock, readHooks, writeHooks, hooksContent, hash, LOCK_FILE } from './managed.mjs'
import { settingsHooks } from '../hooks/runner.mjs'

function project(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aos-managed-'))
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), c) }
  return dir
}
const read = (dir, p) => readFileSync(join(dir, p), 'utf8')
const write = (dir, p, c) => writeFileSync(join(dir, p), c)
const actions = (results) => Object.fromEntries(results.map((r) => [r.key, r.action]))
const RULE = '.claude/rules/git.md'

test('install writes new items, records them in the lock and keeps a merge base', () => {
  const dir = project()
  try {
    assert.deepEqual(actions(applyManaged(dir, [{ key: RULE, content: 'a\nb\n' }], { version: '0.1.0' })), { [RULE]: 'installed' })
    assert.equal(read(dir, RULE), 'a\nb\n')
    assert.deepEqual(readLock(dir).items[RULE], { kind: 'file', version: '0.1.0', sha256: hash('a\nb\n') })
    assert.equal(read(dir, '.agent-os/base/.claude/rules/git.md'), 'a\nb\n')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an unmodified managed file is replaced on update', () => {
  const dir = project()
  try {
    applyManaged(dir, [{ key: RULE, content: 'a\nb\n' }], { version: '0.1.0' })
    assert.deepEqual(actions(applyManaged(dir, [{ key: RULE, content: 'a\nb\nc\n' }], { version: '0.2.0' })), { [RULE]: 'replaced' })
    assert.equal(read(dir, RULE), 'a\nb\nc\n')
    assert.equal(readLock(dir).items[RULE].version, '0.2.0')
    assert.deepEqual(actions(applyManaged(dir, [{ key: RULE, content: 'a\nb\nc\n' }], { version: '0.2.0' })), { [RULE]: 'unchanged' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a user edit to a managed rule and an update to another line are both present', () => {
  const dir = project()
  try {
    applyManaged(dir, [{ key: RULE, content: 'title\nrule one\nrule two\n' }], { version: '0.1.0' })
    write(dir, RULE, 'title\nrule one, as our team does it\nrule two\n')
    assert.deepEqual(actions(applyManaged(dir, [{ key: RULE, content: 'title\nrule one\nrule two\nrule three\n' }], { version: '0.2.0' })), { [RULE]: 'merged' })
    assert.equal(read(dir, RULE), 'title\nrule one, as our team does it\nrule two\nrule three\n')
    // The base is the new version, so the local edit still counts as an edit next time.
    assert.deepEqual(actions(applyManaged(dir, [{ key: RULE, content: 'title\nrule one\nrule two\nrule three\n' }], { version: '0.2.0' })), { [RULE]: 'unchanged' })
    assert.equal(read(dir, RULE), 'title\nrule one, as our team does it\nrule two\nrule three\n')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a conflicting edit leaves the local file untouched, writes .rej, and retries next time', () => {
  const dir = project()
  try {
    applyManaged(dir, [{ key: RULE, content: 'x\nline\ny\n' }], { version: '0.1.0' })
    write(dir, RULE, 'x\nours\ny\n')
    const [r] = applyManaged(dir, [{ key: RULE, content: 'x\ntheirs\ny\n' }], { version: '0.2.0' })
    assert.equal(r.action, 'conflict')
    assert.equal(r.rej, `${RULE}.rej`)
    assert.equal(read(dir, RULE), 'x\nours\ny\n')
    const rej = read(dir, r.rej)
    assert.match(rej, /could not update .*1 conflicting change/)
    assert.match(rej, /<<<<<<< local\nours\n=======\ntheirs\n>>>>>>> agent-os 0\.2\.0/)
    assert.equal(readLock(dir).items[RULE].version, '0.1.0', 'the base stays, so the next update merges again')
    assert.equal(exitCodeFor([r]), 1)
    assert.equal(exitCodeFor([{ action: 'merged' }, { action: 'replaced' }]), 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an existing file that agent-os does not manage is adopted when equal, otherwise left alone with a .rej', () => {
  const dir = project({ 'same.md': 'same\n', 'mine.md': 'my own\n' })
  try {
    const r = applyManaged(dir, [{ key: 'same.md', content: 'same\n' }, { key: 'mine.md', content: 'theirs\n' }], { version: '0.1.0' })
    assert.deepEqual(actions(r), { 'same.md': 'adopted', 'mine.md': 'conflict' })
    assert.equal(read(dir, 'mine.md'), 'my own\n')
    assert.match(read(dir, 'mine.md.rej'), /exists and is not managed by agent-os yet/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('AGENTS.md: only the managed block changes; the team text around it is byte-identical', () => {
  const head = '# Our project\r\n\r\nTeam notes with trailing spaces   \r\n\r\n'
  const tail = '\r\n## Our own section\r\nStays exactly.\r\n'
  const dir = project({ 'AGENTS.md': `${head}<!-- agent-os:begin core -->\r\nold core\r\n<!-- agent-os:end core -->${tail}` })
  try {
    applyManaged(dir, [{ key: 'AGENTS.md#core', content: 'old core' }], { version: '0.1.0' })
    applyManaged(dir, [{ key: 'AGENTS.md#core', content: 'new core\nsecond line' }], { version: '0.2.0' })
    const text = read(dir, 'AGENTS.md')
    assert.ok(text.startsWith(head), 'text before the block is unchanged')
    assert.ok(text.endsWith(tail), 'text after the block is unchanged')
    assert.equal(readBlock(text, 'core'), 'new core\r\nsecond line')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a missing block is appended after the team text', () => {
  assert.equal(writeBlock('# Team\n', 'core', 'x'), '# Team\n\n<!-- agent-os:begin core -->\nx\n<!-- agent-os:end core -->\n')
  assert.equal(writeBlock('', 'core', 'x'), '<!-- agent-os:begin core -->\nx\n<!-- agent-os:end core -->\n')
  assert.equal(readBlock('no block', 'core'), null)
})

test('settings.json: managed hook entries are replaced, every other hook and setting is kept', () => {
  const own = { type: 'command', command: './scripts/my-hook.sh' }
  const settings = { permissions: { allow: ['Bash(npm test)'] }, hooks: { Stop: [{ hooks: [own, { type: 'command', command: 'npx agent-os hook Stop' }] }], Notification: [{ hooks: [own] }] } }
  const dir = project({ '.claude/settings.json': JSON.stringify(settings, null, 2) })
  try {
    const content = hooksContent(settingsHooks('npx --no-install agent-os'))
    const [r] = applyManaged(dir, [{ key: '.claude/settings.json#hooks', content }], { version: '0.1.0' })
    assert.equal(r.action, 'conflict', 'an old unmanaged agent-os entry differs, so it is not overwritten silently')
    rmSync(join(dir, '.claude/settings.json.hooks.rej'))
    const clean = { permissions: settings.permissions, hooks: { Notification: [{ hooks: [own] }], Stop: [{ hooks: [own] }] } }
    write(dir, '.claude/settings.json', JSON.stringify(clean, null, 2))
    assert.equal(applyManaged(dir, [{ key: '.claude/settings.json#hooks', content }], { version: '0.1.0' })[0].action, 'installed')
    const after = JSON.parse(read(dir, '.claude/settings.json'))
    assert.deepEqual(after.permissions, settings.permissions)
    assert.deepEqual(after.hooks.Notification, [{ hooks: [own] }])
    assert.deepEqual(after.hooks.Stop[0], { hooks: [own] })
    assert.equal(after.hooks.Stop[1].hooks[0].command, 'npx --no-install agent-os hook Stop')
    assert.equal(readHooks(after), content)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('writeHooks keeps unrelated events and drops only managed entries', () => {
  const s = writeHooks({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'agent-os hook PreToolUse' }, { command: 'lint' }] }] } }, '{}')
  assert.deepEqual(s, { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'lint' }] }] } })
})

test('eject stops managing a file and leaves its content; updates no longer touch it', () => {
  const dir = project()
  try {
    applyManaged(dir, [{ key: RULE, content: 'a\n' }, { key: 'AGENTS.md#core', content: 'c' }], { version: '0.1.0' })
    assert.deepEqual(eject(dir, RULE), [RULE])
    assert.equal(readLock(dir).items[RULE], undefined)
    assert.equal(existsSync(join(dir, '.agent-os/base/.claude/rules/git.md')), false)
    assert.equal(read(dir, RULE), 'a\n')
    assert.deepEqual(eject(dir, 'AGENTS.md'), ['AGENTS.md#core'])
    assert.throws(() => eject(dir, 'nope.md'), /not managed by agent-os/)
    const again = applyManaged(dir, [{ key: RULE, content: 'b\n' }, { key: 'AGENTS.md#core', content: 'd' }], { version: '0.2.0' })
    assert.deepEqual(again.map((r) => r.action), ['ejected', 'ejected'], 'an ejected path is never re-adopted or rewritten')
    assert.equal(read(dir, RULE), 'a\n')
    assert.deepEqual(readLock(dir).ejected, ['.claude/rules/git.md', 'AGENTS.md'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a file the project kept at install (a conflict with a .rej) can be ejected: its version stays for good', () => {
  const dir = project()
  try {
    mkdirSync(join(dir, '.github'), { recursive: true })
    write(dir, '.github/pull_request_template.md', '# ours\n')
    const first = applyManaged(dir, [{ key: '.github/pull_request_template.md', content: '# agent-os\n' }], { version: '0.1.0' })
    assert.equal(first[0].action, 'conflict')
    assert.ok(existsSync(join(dir, '.github/pull_request_template.md.rej')))
    assert.deepEqual(eject(dir, '.github/pull_request_template.md'), ['.github/pull_request_template.md'])
    assert.equal(existsSync(join(dir, '.github/pull_request_template.md.rej')), false, 'the .rej is resolved by keeping ours')
    const next = applyManaged(dir, [{ key: '.github/pull_request_template.md', content: '# agent-os 2\n' }], { version: '0.2.0' })
    assert.equal(next[0].action, 'ejected')
    assert.equal(read(dir, '.github/pull_request_template.md'), '# ours\n')
    assert.equal(existsSync(join(dir, '.github/pull_request_template.md.rej')), false, 'no new conflict on update')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('relock rebuilds the lock from the merge bases, keeping known versions', () => {
  const dir = project()
  try {
    applyManaged(dir, [{ key: RULE, content: 'a\n' }, { key: 'AGENTS.md#core', content: 'c' }, { key: '.claude/settings.json#hooks', content: '{}\n' }], { version: '0.1.0' })
    const before = readLock(dir)
    write(dir, LOCK_FILE, '<<<<<<< HEAD\nbroken\n')
    assert.throws(() => readLock(dir), /not valid JSON[\s\S]*/)
    assert.deepEqual(relock(dir, { version: '9.9.9' }), ['.claude/rules/git.md', '.claude/settings.json#hooks', 'AGENTS.md#core'])
    const after = readLock(dir)
    for (const k of Object.keys(before.items)) assert.equal(after.items[k].sha256, before.items[k].sha256)
    assert.equal(after.items[RULE].version, '9.9.9', 'an unreadable lock loses its versions; the package version is used')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('--dry-run style apply reports actions and writes nothing', () => {
  const dir = project()
  try {
    assert.deepEqual(actions(applyManaged(dir, [{ key: RULE, content: 'a\n' }], { version: '0.1.0', dryRun: true })), { [RULE]: 'installed' })
    assert.equal(existsSync(join(dir, RULE)), false)
    assert.equal(existsSync(join(dir, LOCK_FILE)), false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a CRLF checkout of an unmodified file does not count as a local edit', () => {
  const dir = project()
  try {
    applyManaged(dir, [{ key: RULE, content: 'a\nb\n' }], { version: '0.1.0' })
    write(dir, RULE, 'a\r\nb\r\n')
    assert.equal(applyManaged(dir, [{ key: RULE, content: 'a\nb\nc\n' }], { version: '0.2.0' })[0].action, 'replaced')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("the hooks of agent-os's own repository (node bin/agent-os.mjs hook …) are managed entries too", async () => {
  const { hooksContent, writeHooks } = await import('./managed.mjs')
  const { settingsHooks } = await import('../hooks/runner.mjs')
  const content = hooksContent(settingsHooks('node bin/agent-os.mjs'))
  assert.match(content, /"command": "node bin\/agent-os\.mjs hook SessionStart"/)
  const settings = writeHooks({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }, content)
  assert.equal(settings.hooks.Stop.length, 2, 'the team hook stays, the managed one is added')
  assert.deepEqual(JSON.parse(hooksContent(writeHooks(settings, content).hooks)), JSON.parse(content), 'rewriting replaces only the managed entries')
})
