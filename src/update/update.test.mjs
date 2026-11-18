// Tests for the update flow against a fixture project: a real git repository with a local bare remote, two versions
// of a template tree, a migration, and a fake tracker. Nothing leaves the temporary directory.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installRoutes } from '../managed/install.mjs'
import { loadConfig } from '../config/config.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'
import { groupedChanges, planMarkdown, planUpdate, runUpdate } from './update.mjs'

const write = (root, files) => { for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c) } }
const RELEASE = {
  version: '0.2.0', node: '>=22', claudeCode: null,
  manifest: { items: { 'config:old.key': { status: 'deprecated', deprecatedIn: '0.2.0', removeIn: '0.4.0', replacement: 'config:new.key' }, 'command:fresh': { status: 'new', since: '0.2.0' }, 'command:older': { status: 'new', since: '0.1.0' } } },
  changelog: [{ version: '0.2.0', changes: [{ group: 'breaking', text: 'the guide changed its second line', refs: ['#1'] }, { group: 'fix', text: 'typo in the rules' }] }, { version: '0.1.0', changes: [{ group: 'new', text: 'first release' }] }],
}

/** A project installed with agent-os 0.1.0, pushed to a bare remote, with a committed local edit to a managed file. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aos-update-'))
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' }
  writeFileSync(join(root, 'gitconfig'), '[init]\n\tdefaultBranch = development\n[commit]\n\tgpgsign = false\n')
  const g = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, env, encoding: 'utf8' }); if (r.status) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim() }
  const remote = join(root, 'remote.git')
  const cwd = join(root, 'app')
  mkdirSync(cwd)
  g(root, 'init', '--bare', '-b', 'development', remote)
  g(cwd, 'init', '-b', 'development')
  g(cwd, 'remote', 'add', 'origin', remote)
  const v1 = join(root, 'templates-v1')
  const v2 = join(root, 'templates-v2')
  write(v1, { 'core/docs/guide.md': 'line one\nline two\nline three\n', 'core/.claude/rules/style.md': 'Use tabs.\n' })
  write(v2, { 'core/docs/guide.md': 'line one\nline two, from 0.2.0\nline three\n', 'core/.claude/rules/style.md': 'Use spaces.\n', 'core/.claude/rules/new.md': 'A new rule.\n' })
  write(cwd, {
    'agent-os.json': `${JSON.stringify({ version: '0.1.0', platform: { type: 'github', project: 'acme/app' }, gate: { unit: 'node --version' } }, null, 2)}\n`,
    '.gitignore': '.agent-os/local.json\n.agent-os/cache/\n',
  })
  installRoutes(cwd, loadConfig(cwd).merged, { version: '0.1.0', templatesRoot: v1 })
  g(cwd, 'add', '-A'); g(cwd, 'commit', '-m', 'install agent-os 0.1.0')
  writeFileSync(join(cwd, 'docs/guide.md'), 'line one\nline two, edited by the team\nline three\n')
  g(cwd, 'commit', '-am', 'team edit'); g(cwd, 'push', '-u', 'origin', 'development')
  const migrations = join(root, 'migrations')
  write(migrations, { '0.2.0.mjs': "export const description = 'set conventions.maxTitleLength'\nexport function migrate(p) { const c = p.readJson('agent-os.json'); if (c.conventions?.maxTitleLength) return; c.conventions = { ...c.conventions, maxTitleLength: 70 }; p.writeJson('agent-os.json', c) }\n" })
  return { root, cwd, v2, migrations, g, git: (args) => { const r = spawnSync('git', args, { cwd, env, encoding: 'utf8' }); return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' } } }
}
const fakeTracker = () => { const calls = []; return { calls, createPullRequest: (spec) => { calls.push(spec); return { number: 70, url: 'https://github.com/acme/app/pull/70' } } } }

test('the plan groups changes between the versions and lists files, conflicts, migrations and deprecated items in use', async () => {
  const f = fixture()
  try {
    const plan = await planUpdate(f.cwd, { release: RELEASE, templatesRoot: f.v2, migrationsDir: f.migrations })
    assert.equal(plan.from, '0.1.0')
    assert.equal(plan.to, '0.2.0')
    assert.deepEqual(plan.groups.breaking.map((c) => c.text), ['the guide changed its second line'])
    assert.deepEqual(plan.groups.new.map((c) => c.text), ['command:fresh'], 'only what is new since the pinned version')
    assert.deepEqual(plan.groups.fix.map((c) => c.text), ['typo in the rules'])
    assert.match(plan.groups.deprecated[0].text, /config:old\.key → config:new\.key \(removed in 0\.4\.0\)/)
    assert.deepEqual(plan.conflicts.map((c) => c.key), ['docs/guide.md'])
    assert.deepEqual(plan.migrations, ['0.2.0'])
    const md = planMarkdown(plan)
    assert.match(md, /### Breaking\n\n- the guide changed its second line \(#1\) _\(0\.2\.0\)_/)
    assert.match(md, /`docs\/guide\.md`: conflict → `docs\/guide\.md\.rej`/)
    assert.equal(f.g(f.cwd, 'status', '--porcelain'), '', 'the plan changes nothing')
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('given a local edit conflicting with the new version, the update runs on its branch and the PR lists the .rej file', async () => {
  const f = fixture()
  try {
    const before = f.g(f.cwd, 'rev-parse', 'development')
    const t = fakeTracker()
    const r = await runUpdate(f.cwd, { git: f.git, tracker: t, vocab: vocabularyFor('github') }, { release: RELEASE, templatesRoot: f.v2, migrationsDir: f.migrations, author: 'ana', now: new Date('2026-11-20T10:00:00Z') })
    assert.equal(r.updated, true)
    assert.equal(r.branch, 'chore/agent-os-0.2.0')
    assert.deepEqual(r.conflicts.map((c) => c.rej), ['docs/guide.md.rej'])
    assert.deepEqual(r.migrations.map((m) => m.version), ['0.2.0'])
    assert.equal(r.gate.ok, true)
    // the change request
    assert.equal(t.calls.length, 1)
    const cr = t.calls[0]
    assert.deepEqual([cr.title, cr.head, cr.base, cr.draft], ['chore(agent-os): update to 0.2.0', 'chore/agent-os-0.2.0', 'development', true])
    assert.match(cr.body, /## Conflicts[\s\S]*- \[ \] `docs\/guide\.md\.rej` \(for `docs\/guide\.md`\)/)
    assert.match(cr.body, /## Before merge\n\n- \[ \] every `\.rej` file above is resolved and deleted/)
    assert.match(cr.body, /To roll back, close this pull request/)
    assert.match(cr.body, /\| unit \| `node --version` \| passed \|/)
    // the branch holds the update; the default branch is untouched, locally and on the remote
    assert.equal(f.g(f.cwd, 'rev-parse', '--abbrev-ref', 'HEAD'), 'development')
    assert.equal(f.g(f.cwd, 'rev-parse', 'development'), before)
    assert.equal(f.g(f.cwd, 'rev-parse', 'origin/development'), before)
    assert.equal(JSON.parse(readFileSync(join(f.cwd, 'agent-os.json'), 'utf8')).version, '0.1.0')
    const pinned = JSON.parse(f.g(f.cwd, 'show', 'chore/agent-os-0.2.0:agent-os.json'))
    assert.equal(pinned.version, '0.2.0')
    assert.equal(pinned.conventions.maxTitleLength, 70, 'the migration ran on the branch')
    assert.equal(f.g(f.cwd, 'show', 'chore/agent-os-0.2.0:docs/guide.md'), 'line one\nline two, edited by the team\nline three', 'the local edit is kept')
    assert.match(f.g(f.cwd, 'show', 'chore/agent-os-0.2.0:docs/guide.md.rej'), /<<<<<<< local[\s\S]*>>>>>>> agent-os 0\.2\.0/)
    assert.equal(f.g(f.cwd, 'show', 'chore/agent-os-0.2.0:.claude/rules/style.md'), 'Use spaces.')
    assert.match(f.g(f.cwd, 'ls-tree', '-r', '--name-only', 'chore/agent-os-0.2.0', '.agent-os/journal'), /2026\/11\/2026-11-20T10-00-ana-agent-os-0-2-0\.md/)
    assert.match(f.g(f.cwd, 'ls-remote', '--heads', 'origin'), /refs\/heads\/chore\/agent-os-0\.2\.0/)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('preflight: a dirty tree, a pre-release without --channel next, or an older version stop before any branch', async () => {
  const f = fixture()
  try {
    writeFileSync(join(f.cwd, 'scratch.txt'), 'x')
    const dirty = await runUpdate(f.cwd, { git: f.git, tracker: fakeTracker(), vocab: vocabularyFor('github') }, { release: RELEASE, templatesRoot: f.v2, migrationsDir: f.migrations })
    assert.equal(dirty.updated, false)
    assert.match(dirty.problems[0], /uncommitted changes/)
    rmSync(join(f.cwd, 'scratch.txt'))
    const pre = await runUpdate(f.cwd, { git: f.git, vocab: vocabularyFor('github') }, { release: { ...RELEASE, version: '0.3.0-next.1' }, templatesRoot: f.v2, migrationsDir: f.migrations })
    assert.match(pre.problems[0], /pre-release: pass --channel next/)
    const old = await runUpdate(f.cwd, { git: f.git, vocab: vocabularyFor('github') }, { release: { ...RELEASE, version: '0.0.9' }, templatesRoot: f.v2, migrationsDir: f.migrations })
    assert.match(old.problems[0], /older than the pinned 0\.1\.0/)
    assert.doesNotMatch(f.g(f.cwd, 'branch', '--list'), /chore\/agent-os/)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('--channel next tries a pre-release without changing the pin; --no-pr pushes nothing', async () => {
  const f = fixture()
  try {
    const r = await runUpdate(f.cwd, { git: f.git, vocab: vocabularyFor('github') }, { release: { ...RELEASE, version: '0.3.0-next.1' }, templatesRoot: f.v2, migrationsDir: f.migrations, channel: 'next', open: false })
    assert.equal(r.updated, true)
    assert.equal(r.changeRequest, null)
    assert.equal(JSON.parse(f.g(f.cwd, 'show', 'chore/agent-os-0.3.0-next.1:agent-os.json')).version, '0.1.0')
    assert.doesNotMatch(f.g(f.cwd, 'ls-remote', '--heads', 'origin'), /chore\//)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('changes are grouped by version range, lifecycle items included', () => {
  const g = groupedChanges({ from: '0.1.0', to: '0.2.0', ...RELEASE })
  assert.deepEqual(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.length])), { breaking: 1, new: 1, deprecated: 1, legacy: 0, removed: 0, fix: 1, chore: 0 })
  assert.equal(groupedChanges({ from: null, to: '0.2.0', ...RELEASE }).new.length, 3, 'unpinned: everything up to the target')
})
