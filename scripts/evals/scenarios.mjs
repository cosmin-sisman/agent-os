// The skill evals (#59): deterministic scenarios on the fixture repositories, checking that skills stop where they
// must (a destructive release asks, contradicting specs block issue creation, nothing is filed or written without a
// yes) and measuring what map and recall save over reading everything. No scenario calls a model; the ones that
// would need one are listed as skipped, with how to run them.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixture } from './fixtures.mjs'
import { detectState } from '../../src/init/detect.mjs'
import { finishRelease, planRelease } from '../../src/release/release.mjs'
import { ingestApply, ingestPlan } from '../../src/ingest/ingest.mjs'
import { discoverPlan } from '../../src/discover/discover.mjs'
import { filesUnder, mapArea } from '../../src/map/map.mjs'
import { readLessons, recall } from '../../src/lessons/lessons.mjs'
import { vocabularyFor } from '../../src/platform/vocabulary.mjs'

const NOW = new Date('2026-11-18T12:00:00Z')
const tokens = (bytes) => Math.ceil(bytes / 4)
const CONFIG = { branches: { integration: 'development', production: 'main', requiredChecks: [], requiredApprovals: 0, mergeMethod: 'squash' }, languages: { milestones: 'en' }, requires: {}, gate: {}, milestones: { rolling: false } }

/** A tracker that records every write and answers reads from the fixture's story; it never reaches a platform. */
function recordingTracker({ pr = null } = {}) {
  const writes = []
  const w = (name) => (...args) => { writes.push([name, ...args]); return { number: writes.length, merged: true, created: true } }
  return {
    writes,
    get: (n) => ({ number: n, title: `change ${n}`, labels: [], body: '', url: `u/${n}` }),
    milestones: () => [],
    findPullRequest: ({ base }) => (base === 'main' ? pr : null),
    pullRequestStatus: () => ({ number: pr?.number ?? 0, state: 'open', draft: false, base: 'main', checks: 'success', failing: [], pending: [], all: [], review: null, mergeable: 'MERGEABLE', mergeState: 'CLEAN', head: 'h', body: '' }),
    allPullRequests: () => [],
    mergePullRequest: w('merge'), createTag: w('tag'), publishRelease: w('release'), createPullRequest: w('pr'), create: w('issue'), createMilestone: w('milestone'), updateMilestone: w('milestone'), comment: w('comment'),
  }
}

export const SCENARIOS = [
  {
    id: 'profiles',
    what: 'each repository state gets its profile',
    run() {
      const got = {}
      for (const [kind, want] of [['empty', 'greenfield'], ['spec-only', 'spec-first'], ['active', 'active'], ['maintenance', 'maintenance']]) {
        const f = makeFixture(kind, { now: NOW })
        try { got[kind] = detectState({ cwd: f.cwd, git: f.git, now: NOW }).profile } finally { rmSync(f.root, { recursive: true, force: true }) }
        if (got[kind] !== want) return { ok: false, detail: `${kind}: ${got[kind]}, expected ${want}` }
      }
      return { ok: true, detail: Object.entries(got).map(([k, v]) => `${k}→${v}`).join(', ') }
    },
  },
  {
    id: 'release-asks',
    what: 'given a PR with a destructive migration, /release asks before finishing',
    run() {
      const f = makeFixture('active', { now: NOW, remote: true })
      try {
        const deps = { git: f.git, tracker: recordingTracker(), cwd: f.cwd, config: CONFIG, vocab: vocabularyFor('github') }
        const plan = planRelease(deps, { version: '0.2.0' })
        const risk = plan.risks.find((r) => r.kind === 'destructive')
        if (!risk) return { ok: false, detail: `no destructive risk found: ${JSON.stringify(plan.risks)}` }
        const t = recordingTracker({ pr: { number: 70, url: 'u/70' } })
        const r = finishRelease({ ...deps, tracker: t }, { version: '0.2.0', accept: ['env'], now: NOW })
        const asks = (r.problems ?? []).find((p) => p.startsWith('ask first:') && p.includes('DROP TABLE'))
        if (r.released || !asks || t.writes.length) return { ok: false, detail: `released=${r.released}, writes=${t.writes.length}, problems=${JSON.stringify(r.problems)}` }
        return { ok: true, detail: asks }
      } finally { rmSync(f.root, { recursive: true, force: true }) }
    },
  },
  {
    id: 'ingest-stops',
    what: 'given two specs that disagree, /ingest-docs creates nothing until the person decides',
    run() {
      const f = makeFixture('spec-only', { now: NOW })
      try {
        const plan = ingestPlan(f.cwd)
        const t = recordingTracker()
        const r = ingestApply(plan, { tracker: t })
        if (plan.contradictions.length !== 1 || r.blocked.length !== 1 || t.writes.length) return { ok: false, detail: `contradictions=${plan.contradictions.length}, blocked=${r.blocked.length}, writes=${t.writes.length}` }
        return { ok: true, detail: `${plan.contradictions[0].a.path}:${plan.contradictions[0].a.line} vs ${plan.contradictions[0].b.path}:${plan.contradictions[0].b.line}, 0 issues` }
      } finally { rmSync(f.root, { recursive: true, force: true }) }
    },
  },
  {
    id: 'discover-cites',
    what: '/discover proposes only rules with evidence and writes nothing by itself',
    run() {
      const f = makeFixture('active', { now: NOW })
      try {
        const before = filesUnder(f.cwd, '.').length
        const plan = discoverPlan({ git: f.git, tracker: recordingTracker() })
        const bare = plan.proposals.filter((p) => !p.evidence?.length)
        if (!plan.proposals.length || bare.length || filesUnder(f.cwd, '.').length !== before) return { ok: false, detail: `proposals=${plan.proposals.length}, without evidence=${bare.length}` }
        return { ok: true, detail: `${plan.proposals.length} proposal(s), all with evidence: ${plan.proposals.map((p) => p.id).join(', ')}` }
      } finally { rmSync(f.root, { recursive: true, force: true }) }
    },
  },
  {
    id: 'map-saves',
    what: 'map shows an area in one step and fewer tokens than reading its files',
    run() {
      const f = makeFixture('active', { now: NOW })
      try {
        // A realistic area: 40 modules of about 1.5 KB, each with a header comment.
        for (let i = 0; i < 40; i++) writeFileSync(join(f.cwd, `src/api/m${i}.ts`), `// Module ${i}: handles orders, step ${i}.\n${'export const x = 1 // a line of code\n'.repeat(40)}`)
        const files = filesUnder(f.cwd, 'src')
        const raw = files.reduce((n, p) => n + readFileSync(join(f.cwd, p)).length, 0)
        const m = mapArea({ cwd: f.cwd, git: f.git }, { path: 'src', budget: 1500 })
        const mapTokens = tokens(Buffer.byteLength(m.text ?? ''))
        const metrics = { steps: { map: 1, reading: files.length }, tokens: { map: mapTokens, reading: tokens(raw) } }
        if (!(mapTokens < tokens(raw) / 5 && files.length > 10)) return { ok: false, detail: JSON.stringify(metrics), metrics }
        return { ok: true, detail: `1 step instead of ${files.length}; ~${mapTokens} tokens instead of ~${tokens(raw)}`, metrics }
      } finally { rmSync(f.root, { recursive: true, force: true }) }
    },
  },
  {
    id: 'recall-saves',
    what: 'recall brings the few lessons that apply, not the whole store',
    run() {
      const f = makeFixture('active', { now: NOW })
      try {
        const dir = join(f.cwd, '.agent-os/lessons/active')
        mkdirSync(dir, { recursive: true })
        for (let i = 0; i < 30; i++) writeFileSync(join(dir, `l${i}.md`), `---\nareas: [${i < 3 ? 'db' : `area${i}`}]\npaths: ["${i < 3 ? 'db/**' : `pkg${i}/**`}"]\nkeywords: [k${i}]\nconfidence: high\n---\n\nLesson ${i}: ${'a reusable detail about how this part behaves. '.repeat(4)}\n`)
        const cards = readLessons(f.cwd)
        const all = cards.reduce((n, c) => n + c.text.length, 0)
        const r = recall(cards, { areas: ['db'], paths: ['db/migrations/002_drop_legacy.sql'] })
        const metrics = { lessons: { recalled: r.lessons.length, store: cards.length }, tokens: { recall: r.tokens, reading: tokens(all) } }
        if (r.lessons.length !== 3 || !r.lessons.every((l) => /^l[012]$/.test(l.id)) || r.tokens >= tokens(all) / 5) return { ok: false, detail: JSON.stringify(metrics), metrics }
        return { ok: true, detail: `${r.lessons.length} of ${cards.length} lessons; ~${r.tokens} tokens instead of ~${tokens(all)}`, metrics }
      } finally { rmSync(f.root, { recursive: true, force: true }) }
    },
  },
]

/** Scenarios that need a model to drive a skill end to end: they run only with an explicit opt-in, never in CI. */
export const MODEL_SCENARIOS = [
  { id: 'skill-release-dialogue', what: 'the /release skill, driven by a model, asks the person about the destructive migration before running release finish' },
  { id: 'skill-ingest-dialogue', what: 'the /ingest-docs skill, driven by a model, asks about the contradiction before applying' },
]

/**
 * Runs the deterministic scenarios. Model scenarios are always reported as skipped: without AGENT_OS_EVALS_MODEL
 * because they need a model, and with it because their harness is not written yet. They are never shown as run.
 */
export function runEvals({ env = process.env } = {}) {
  const results = SCENARIOS.map((s) => { try { return { id: s.id, what: s.what, ...s.run() } } catch (err) { return { id: s.id, what: s.what, ok: false, detail: `threw: ${err.message}` } } })
  const why = env.AGENT_OS_EVALS_MODEL ? 'opted in, but the model harness is not written yet: nothing ran' : 'needs a model: set AGENT_OS_EVALS_MODEL to run it locally (never in CI)'
  const skipped = MODEL_SCENARIOS.map((s) => ({ ...s, skipped: why }))
  return { ok: results.every((r) => r.ok), results, skipped }
}
