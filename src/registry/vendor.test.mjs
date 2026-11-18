// Tests for vendored skills: add at a pinned commit (registry entry and lock record, nothing run), update showing the
// diff between commits and writing only when confirmed, refusing edited vendored files, remove leaving no folder,
// entry or slot binding behind, and scaffolding a local skill. GitHub is a fake gh; nothing is fetched for real.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'
import { fakeGh } from '../tracker/__fixtures__/fake-gh.mjs'
import { readLock } from '../managed/managed.mjs'
import { readRegistry } from './registry.mjs'
import { addSkill, diffFiles, githubFetcher, parseSource } from './vendor.mjs'
import { ghClient } from '../tracker/gh.mjs'

const b64 = (s) => Buffer.from(s).toString('base64')
const SKILL_V1 = '---\nname: tidy\ndescription: Tidies things.\n---\n\n# /tidy\n\nStep one.\n'
const SKILL_V2 = '---\nname: tidy\ndescription: Tidies things.\n---\n\n# /tidy\n\nStep one, carefully.\n'

/** A fake upstream repo acme/skills with skills/tidy at two commits: v1 (aaa) and main (bbb). */
function upstream() {
  const trees = {
    aaa: [{ path: 'README.md', type: 'blob', sha: 'r1' }, { path: 'skills/tidy/SKILL.md', type: 'blob', sha: 's1' }, { path: 'skills/tidy/install.sh', type: 'blob', sha: 'i1' }, { path: 'skills/tidy/LICENSE', type: 'blob', sha: 'l1' }, { path: 'skills/tidy/link', type: 'blob', mode: '120000', sha: 'x' }],
    bbb: [{ path: 'skills/tidy/SKILL.md', type: 'blob', sha: 's2' }, { path: 'skills/tidy/LICENSE', type: 'blob', sha: 'l1' }, { path: 'skills/tidy/notes.md', type: 'blob', sha: 'n2' }],
  }
  const blobs = { r1: 'readme', s1: SKILL_V1, s2: SKILL_V2, i1: '#!/bin/sh\ntouch PWNED\n', l1: 'MIT License\n\nPermission is hereby granted, free of charge…', n2: 'notes\n' }
  return fakeGh({
    'GET repos/acme/skills/commits/v1': { sha: 'aaa' },
    'GET repos/acme/skills/commits/main': { sha: 'bbb' },
    'GET repos/acme/skills/git/trees/aaa?recursive=1': { tree: trees.aaa },
    'GET repos/acme/skills/git/trees/bbb?recursive=1': { tree: trees.bbb },
    ...Object.fromEntries(Object.entries(blobs).map(([k, v]) => [`GET repos/acme/skills/git/blobs/${k}`, { content: b64(v), encoding: 'base64' }])),
  })
}

const tmp = () => mkdtempSync(join(tmpdir(), 'aos-vendor-'))
async function cli(cwd, argv, { gh, ask } = {}) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {}, gh, ...(ask ? { ask } : {}) })
  return { code, stdout, stderr }
}

test('sources: github with a path and a ref, or a local folder; anything else is refused', () => {
  assert.deepEqual(parseSource('github:acme/skills/skills/tidy@v1'), { kind: 'remote', host: 'github', owner: 'acme', repo: 'skills', path: 'skills/tidy', ref: 'v1' })
  assert.equal(parseSource('./vendor/tidy').kind, 'local')
  assert.throws(() => parseSource('acme/skills'), /not a skill source/)
})

test('add vendors the skill at the pinned commit: files copied as data, registry entry and lock record, nothing run', async () => {
  const cwd = tmp()
  try {
    const gh = upstream()
    const r = await cli(cwd, ['skill', 'add', 'github:acme/skills/skills/tidy@v1', '--provides', 'review', '--json'], { gh })
    assert.equal(r.code, 0, r.stderr)
    const dir = join(cwd, '.claude/skills/tidy')
    assert.equal(readFileSync(join(dir, 'SKILL.md'), 'utf8'), SKILL_V1)
    assert.ok(existsSync(join(dir, 'install.sh')), 'copied as a file')
    assert.equal(statSync(join(dir, 'install.sh')).mode & 0o111, 0, 'never executable')
    assert.equal(existsSync(join(cwd, 'PWNED')), false, 'nothing from the source ran')
    assert.equal(existsSync(join(dir, 'link')), false, 'symlinks are skipped')
    assert.equal(existsSync(join(dir, 'README.md')), false, 'only the path asked for')
    const entry = readRegistry(cwd).find((e) => e.entry.name === 'tidy').entry
    assert.deepEqual([entry.origin, entry.source, entry.license, entry.provides], ['external', 'github:acme/skills/skills/tidy@aaa', 'MIT', ['review']])
    const rec = readLock(cwd).vendored.tidy
    assert.deepEqual([rec.commit, rec.ref, rec.folder], ['aaa', 'v1', '.claude/skills/tidy'])
    assert.match(rec.files['SKILL.md'], /^[0-9a-f]{64}$/)
    assert.ok(gh.calls.every((c) => c.key.startsWith('GET ')), 'only reads')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('given an external skill updated upstream, update shows the diff before writing and writes only when confirmed', async () => {
  const cwd = tmp()
  try {
    const gh = upstream()
    await cli(cwd, ['skill', 'add', 'github:acme/skills/skills/tidy@v1'], { gh })
    const preview = await cli(cwd, ['skill', 'update', 'tidy', '--ref', 'main'], { gh })
    assert.equal(preview.code, 1, 'not confirmed: nothing written, check failed')
    assert.match(preview.stdout, /aaa → bbb/)
    assert.match(preview.stdout, /changed SKILL\.md[\s\S]*-Step one\.[\s\S]*\+Step one, carefully\./)
    assert.match(preview.stdout, /removed install\.sh/)
    assert.match(preview.stdout, /added notes\.md/)
    assert.equal(readFileSync(join(cwd, '.claude/skills/tidy/SKILL.md'), 'utf8'), SKILL_V1)

    const declined = await cli(cwd, ['skill', 'update', 'tidy', '--ref', 'main'], { gh, ask: async () => 'n' })
    assert.match(declined.stderr, /changed SKILL\.md/, 'the diff is shown before the question')
    assert.equal(readFileSync(join(cwd, '.claude/skills/tidy/SKILL.md'), 'utf8'), SKILL_V1)

    const yes = await cli(cwd, ['skill', 'update', 'tidy', '--ref', 'main', '--yes', '--json'], { gh })
    assert.equal(yes.code, 0, yes.stderr)
    assert.equal(readFileSync(join(cwd, '.claude/skills/tidy/SKILL.md'), 'utf8'), SKILL_V2)
    assert.equal(existsSync(join(cwd, '.claude/skills/tidy/install.sh')), false)
    const rec = readLock(cwd).vendored.tidy
    assert.deepEqual([rec.commit, rec.ref, Object.keys(rec.files).sort()], ['bbb', 'main', ['LICENSE', 'SKILL.md', 'notes.md']])
    assert.equal(readRegistry(cwd).find((e) => e.entry.name === 'tidy').entry.source, 'github:acme/skills/skills/tidy@bbb')
    assert.match((await cli(cwd, ['skill', 'update', 'tidy'], { gh })).stdout, /already at bbb/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('update refuses vendored files edited in place', async () => {
  const cwd = tmp()
  try {
    const gh = upstream()
    await cli(cwd, ['skill', 'add', 'github:acme/skills/skills/tidy@v1'], { gh })
    writeFileSync(join(cwd, '.claude/skills/tidy/SKILL.md'), `${SKILL_V1}my tweak\n`)
    const r = await cli(cwd, ['skill', 'update', 'tidy', '--ref', 'main', '--yes'], { gh })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /were edited: SKILL\.md[\s\S]*local skill/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('remove deletes only the folder in the lock, and leaves no folder, entry or slot binding behind', async () => {
  const cwd = tmp()
  try {
    const gh = upstream()
    writeFileSync(join(cwd, 'agent-os.json'), `${JSON.stringify({ slots: { review: 'tidy', standards: 'other' } }, null, 2)}\n`)
    mkdirSync(join(cwd, '.claude/skills/neighbour'), { recursive: true })
    writeFileSync(join(cwd, '.claude/skills/neighbour/SKILL.md'), 'x')
    await cli(cwd, ['skill', 'add', 'github:acme/skills/skills/tidy@v1', '--provides', 'review'], { gh })
    const dry = await cli(cwd, ['skill', 'remove', 'tidy', '--dry-run'], { gh })
    assert.match(dry.stdout, /delete \.claude\/skills\/tidy\/[\s\S]*unbind slot review/)
    assert.ok(existsSync(join(cwd, '.claude/skills/tidy')))
    assert.equal((await cli(cwd, ['skill', 'remove', 'tidy'], { gh })).code, 0)
    assert.equal(existsSync(join(cwd, '.claude/skills/tidy')), false)
    assert.ok(existsSync(join(cwd, '.claude/skills/neighbour/SKILL.md')))
    assert.equal(readRegistry(cwd).some((e) => e.entry.name === 'tidy'), false)
    assert.equal(readLock(cwd).vendored.tidy, undefined)
    assert.deepEqual(JSON.parse(readFileSync(join(cwd, 'agent-os.json'), 'utf8')).slots, { review: null, standards: 'other' })
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('a local folder can be vendored too, and updated from that folder', async () => {
  const cwd = tmp()
  const src = tmp()
  try {
    writeFileSync(join(src, 'SKILL.md'), SKILL_V1)
    assert.equal((await cli(cwd, ['skill', 'add', src])).code, 0)
    assert.equal(readRegistry(cwd).find((e) => e.entry.name === 'tidy').entry.origin, 'local')
    writeFileSync(join(src, 'SKILL.md'), SKILL_V2)
    assert.match((await cli(cwd, ['skill', 'update', 'tidy'])).stderr, /--from <folder>/)
    assert.equal((await cli(cwd, ['skill', 'update', 'tidy', '--from', src, '--yes'])).code, 0)
    assert.equal(readFileSync(join(cwd, '.claude/skills/tidy/SKILL.md'), 'utf8'), SKILL_V2)
  } finally { rmSync(cwd, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true }) }
})

test('add refuses a source without SKILL.md, a path escaping the folder, and an existing folder', () => {
  const cwd = tmp()
  try {
    const fetch = (files) => () => ({ commit: 'c', files: files.map(([path, s]) => ({ path, content: Buffer.from(s) })) })
    assert.throws(() => addSkill(cwd, { source: 'github:a/b@v', fetch: fetch([['README.md', 'x']]) }), /no SKILL\.md/)
    assert.throws(() => addSkill(cwd, { source: 'github:a/b@v', fetch: fetch([['SKILL.md', SKILL_V1], ['../../evil', 'x']]) }), /outside its folder/)
    assert.equal(existsSync(join(cwd, 'evil')), false)
    assert.equal(existsSync(join(cwd, '.claude/skills/tidy')), false, 'nothing written when one path is bad')
    mkdirSync(join(cwd, '.claude/skills/tidy'), { recursive: true })
    assert.throws(() => addSkill(cwd, { source: 'github:a/b@v', fetch: fetch([['SKILL.md', SKILL_V1]]) }), /already exists/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('new scaffolds a local skill with a Learn step and its registry entry', async () => {
  const cwd = tmp()
  try {
    assert.equal((await cli(cwd, ['skill', 'new', 'seed-db', '--description', 'Seeds the dev database.'])).code, 0)
    const text = readFileSync(join(cwd, '.claude/skills/seed-db/SKILL.md'), 'utf8')
    assert.match(text, /^name: seed-db$/m)
    assert.match(text, /## Learn/)
    assert.equal(readRegistry(cwd).find((e) => e.entry.name === 'seed-db').entry.origin, 'local')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the diff lists added, removed and changed files', () => {
  assert.deepEqual(diffFiles({ a: '1\n2', b: 'x' }, { a: '1\n3', c: 'y' }).map((d) => [d.path, d.status, d.lines]), [['a', 'changed', ['-2', '+3']], ['b', 'removed', ['-x']], ['c', 'added', ['+y']]])
  assert.equal(typeof githubFetcher(ghClient(fakeGh({}))), 'function')
})
