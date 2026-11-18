// Tests for repository state detection: the four profiles from real git fixtures and from signals, with a reason.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectState, suggestProfile } from './detect.mjs'

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'aos-detect-'))
  writeFileSync(join(root, '.gitconfig-test'), '[commit]\n\tgpgsign = false\n')
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, '.gitconfig-test'), GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@e.com' }
  const cwd = join(root, 'r')
  mkdirSync(cwd)
  const g = (...args) => spawnSync('git', args, { cwd, env, encoding: 'utf8' })
  g('init', '-q')
  const git = (args) => g(...args)
  const commit = (date, file, content = 'x') => { mkdirSync(join(cwd, file, '..'), { recursive: true }); writeFileSync(join(cwd, file), content); g('add', '-A'); spawnSync('git', ['commit', '-qm', `c ${file}`], { cwd, env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, encoding: 'utf8' }) }
  return { root, cwd, git, g, commit }
}
const NOW = new Date('2026-11-18T12:00:00Z')

test('given an empty repo, greenfield', () => {
  const r = repo()
  try {
    const d = detectState({ cwd: r.cwd, git: r.git, now: NOW })
    assert.equal(d.profile, 'greenfield')
    assert.equal(d.confidence, 'high')
    assert.equal(d.reason, '0 commit(s) and no code: a new project')
  } finally { rmSync(r.root, { recursive: true, force: true }) }
})

test('given tags and no commits for 6 months, maintenance', () => {
  const r = repo()
  try {
    for (let i = 0; i < 12; i++) r.commit(`2025-0${1 + (i % 9)}-1${i % 9}T10:00:00Z`, `src/m${i}.ts`)
    r.g('tag', 'v1.0.0')
    const d = detectState({ cwd: r.cwd, git: r.git, now: NOW })
    assert.equal(d.profile, 'maintenance')
    assert.match(d.reason, /^1 tag\(s\) and no commit for \d+ days: a finished project in maintenance$/)
  } finally { rmSync(r.root, { recursive: true, force: true }) }
})

test('docs and specs with little code: spec-first; recent commits or open change requests: active', () => {
  const r = repo()
  try {
    for (const f of ['docs/vision.md', 'docs/specs/api.md', 'docs/specs/data.md', 'specs/flows.md']) r.commit('2026-11-01T10:00:00Z', f)
    assert.equal(detectState({ cwd: r.cwd, git: r.git, now: NOW }).profile, 'spec-first')
    for (let i = 0; i < 12; i++) r.commit(`2026-11-0${1 + (i % 9)}T1${i % 9}:00:00Z`, `src/app/f${i}.ts`)
    const d = detectState({ cwd: r.cwd, git: r.git, now: NOW, tracker: { openPullRequests: () => [{}, {}] } })
    assert.equal(d.profile, 'active')
    assert.equal(d.confidence, 'high')
    assert.match(d.reason, /commit\(s\) in 90 days and 2 open change request\(s\): in active development/)
  } finally { rmSync(r.root, { recursive: true, force: true }) }
})

test('signals are read offline; a failing platform leaves open change requests unknown', () => {
  const r = repo()
  try {
    r.commit('2026-11-01T10:00:00Z', 'CLAUDE.md')
    mkdirSync(join(r.cwd, '.github/workflows'), { recursive: true })
    const d = detectState({ cwd: r.cwd, git: r.git, now: NOW, tracker: { openPullRequests: () => { throw new Error('offline') } } })
    assert.deepEqual(d.signals.agentFiles, ['CLAUDE.md'])
    assert.deepEqual(d.signals.ci, ['.github/workflows'])
    assert.equal(d.signals.openChangeRequests, null)
  } finally { rmSync(r.root, { recursive: true, force: true }) }
})

test('every suggestion explains itself in one line', () => {
  for (const s of [{ commits: 300, recentCommits: 2, tags: 3, codeFiles: 80, docFiles: 4, daysSinceLastCommit: 40, openChangeRequests: 0 }, { commits: 40, recentCommits: 1, tags: 0, codeFiles: 30, docFiles: 0, daysSinceLastCommit: 100, openChangeRequests: null }]) {
    const p = suggestProfile(s)
    assert.ok(p.reason && !p.reason.includes('\n'))
  }
  assert.equal(suggestProfile({ commits: 300, recentCommits: 2, tags: 3, codeFiles: 80, docFiles: 4, daysSinceLastCommit: 40, openChangeRequests: 0 }).profile, 'maintenance')
})
