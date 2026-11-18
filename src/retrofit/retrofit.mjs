// Retrofit: bring an existing repository's history into the system (design §12). `planRetrofit` writes a reviewable
// plan: convention labels created and mapped from the labels the project already uses, closed milestones from release
// tags, merged change requests linked on the issues they closed, open change requests' titles and bodies normalized,
// and one baseline journal entry from history. `applyRetrofit` executes it idempotently, rate-limited, and marks what
// it touched. Closed change requests are never rewritten: what they hold goes into the baseline journal instead.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { checkTitle, referencedIssues } from '../conventions/conventions.mjs'
import { LABELS, label, languageFor } from '../i18n/i18n.mjs'
import { addEntry, readJournal } from '../journal/journal.mjs'

export const PLAN_FILE = '.agent-os/retrofit/plan.json'
export const MARKER = '<!-- agent-os:retrofit -->'
const BASELINE = 'Baseline: the history before agent-os'

/** Labels projects commonly use, mapped to the convention's ids. */
export const SYNONYMS = {
  bug: 'type:bug', defect: 'type:bug', regression: 'type:bug',
  enhancement: 'type:feature', feature: 'type:feature', 'feature request': 'type:feature',
  documentation: 'type:docs', docs: 'type:docs',
  chore: 'type:chore', maintenance: 'type:chore', dependencies: 'type:chore',
  security: 'security',
}
const SECTIONS = { en: ['How it was tested', 'Lessons'], ro: ['Cum a fost testat', 'Lectii'] }

/** Release tags with their dates, from git (vX.Y.Z or X.Y.Z). */
function releaseTags(git) {
  const r = git(['for-each-ref', '--sort=creatordate', '--format=%(refname:short)|%(creatordate:short)', 'refs/tags'])
  if (r.status !== 0) return []
  return r.stdout.split(/\r?\n/).map((l) => l.split('|')).filter(([t]) => /^v?\d+\.\d+\.\d+$/.test(t ?? '')).map(([tag, date]) => ({ tag, date }))
}

/** The plan: steps an agent and a person can review before anything changes. */
export function planRetrofit({ tracker, git, config, now = new Date() }) {
  const lang = languageFor(config, 'labels')
  const prLang = languageFor(config, 'prs')
  const steps = []
  const existing = new Set(tracker.labels().map((l) => l.toLowerCase()))
  const name = (id) => label(id, lang).name
  const missing = LABELS.filter((l) => !existing.has(name(l.id).toLowerCase())).map((l) => name(l.id))
  if (missing.length) steps.push({ id: 'labels', kind: 'labels', create: missing, why: 'the convention labels the project does not have yet (agent-os setup --only labels)' })

  const issues = tracker.allIssues()
  for (const [from, id] of Object.entries(SYNONYMS)) {
    const to = name(id)
    if (from === to.toLowerCase()) continue
    const hits = issues.filter((i) => i.labels.some((l) => l.toLowerCase() === from) && !i.labels.includes(to))
    if (hits.length) steps.push({ id: `map:${from}`, kind: 'label-map', from, to, issues: hits.map((i) => i.number), why: `issues labelled "${from}" also get "${to}"; "${from}" stays` })
  }

  const milestones = new Set(tracker.milestones().map((m) => m.title))
  for (const t of releaseTags(git)) if (!milestones.has(t.tag)) steps.push({ id: `milestone:${t.tag}`, kind: 'milestone', title: t.tag, date: t.date, why: `release tag ${t.tag} (${t.date}) has no milestone; created closed` })

  const prs = tracker.allPullRequests()
  const issueNumbers = new Set(issues.map((i) => i.number))
  for (const pr of prs.filter((p) => p.merged)) {
    const refs = referencedIssues(`${pr.title}\n${pr.body}`).filter((n) => issueNumbers.has(n))
    for (const n of refs) steps.push({ id: `link:${pr.number}:${n}`, kind: 'issue-link', issue: n, pr: pr.number, why: `#${pr.number} (merged) refers to #${n}; a comment on the issue records the link` })
  }

  for (const pr of prs.filter((p) => p.state === 'open')) {
    const t = checkTitle(pr.title, pr.body, config.conventions ?? {}, { lang: prLang })
    // A title the conventions can fix gets the fixed one; one they cannot (an unknown type) is left for a person.
    if (t.problems?.length && t.suggestion !== pr.title) steps.push({ id: `title:${pr.number}`, kind: 'pr-title', pr: pr.number, from: pr.title, to: t.suggestion ?? null, why: `${t.problems.join('; ')}${t.suggestion ? '' : ' (no automatic title: the author renames it)'}` })
    const want = SECTIONS[prLang] ?? SECTIONS.en
    const lacking = want.filter((s) => !new RegExp(`^##\\s+${s}\\s*$`, 'mi').test(pr.body))
    if (lacking.length) steps.push({ id: `body:${pr.number}`, kind: 'pr-body', pr: pr.number, add: lacking, why: `the description lacks ${lacking.join(' and ')}` })
  }

  const closed = prs.filter((p) => p.state !== 'open')
  const merged = closed.filter((p) => p.merged)
  const authors = [...new Set(prs.map((p) => p.author).filter(Boolean))].sort()
  const dates = prs.map((p) => p.createdAt).filter(Boolean).sort()
  const body = [
    `${prs.length} change request(s) before agent-os: ${merged.length} merged, ${closed.length - merged.length} closed without merging, ${prs.length - closed.length} open. ${issues.length} issue(s). Contributors: ${authors.join(', ') || 'none recorded'}.${dates.length ? ` From ${dates[0].slice(0, 10)} to ${dates.at(-1).slice(0, 10)}.` : ''}`,
    '',
    'Closed change requests are not rewritten; this entry keeps what they were:',
    '',
    ...merged.slice(0, 100).map((p) => `- #${p.number} ${p.title}${p.mergedAt ? ` (merged ${p.mergedAt.slice(0, 10)})` : ''}`),
    ...(merged.length > 100 ? [`- … and ${merged.length - 100} more`] : []),
  ].join('\n')
  steps.push({ id: 'journal', kind: 'journal', title: BASELINE, body, why: 'one baseline entry from history' })
  return { version: 1, created: now.toISOString(), counts: { prs: prs.length, closed: closed.length, merged: merged.length, issues: issues.length }, steps }
}

/** Writes the plan for review. */
export function savePlan(cwd, plan) {
  const file = join(cwd, PLAN_FILE)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`)
  return PLAN_FILE
}

/**
 * Executes a plan. Each step checks the current state first and does nothing when it is already done, so applying
 * twice changes nothing the second time. Writes are spaced by `delayMs`. Returns what was applied and skipped.
 */
export async function applyRetrofit({ tracker, cwd, config, setupLabels, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), author, now = new Date() }, plan, { dryRun = false, delayMs = 250 } = {}) {
  if (plan?.version !== 1 || !Array.isArray(plan.steps)) throw new CliError(`${PLAN_FILE} is not a retrofit plan`, { hint: 'agent-os retrofit plan writes one' })
  const applied = []
  const skipped = []
  let writes = 0
  const write = async (fn) => { if (dryRun) return; if (writes++) await sleep(delayMs); await fn() }
  const prs = new Map(tracker.allPullRequests().map((p) => [p.number, p]))
  const issues = new Map(tracker.allIssues().map((i) => [i.number, i]))
  const skip = (s, why) => skipped.push({ id: s.id, why })
  for (const s of plan.steps) {
    if (s.kind === 'labels') {
      const have = new Set(tracker.labels().map((l) => l.toLowerCase()))
      const create = s.create.filter((n) => !have.has(n.toLowerCase()))
      if (!create.length) { skip(s, 'the labels exist'); continue }
      if (!setupLabels) { skip(s, 'run agent-os setup --only labels'); continue }
      await write(() => setupLabels())
      applied.push({ id: s.id, did: `created ${create.length} label(s) through setup` })
    } else if (s.kind === 'label-map') {
      const todo = s.issues.filter((n) => issues.has(n) && !issues.get(n).labels.includes(s.to))
      if (!todo.length) { skip(s, 'already labelled'); continue }
      for (const n of todo) await write(() => tracker.update(n, { addLabels: [s.to] }))
      applied.push({ id: s.id, did: `added ${s.to} to ${todo.map((n) => `#${n}`).join(', ')}` })
    } else if (s.kind === 'milestone') {
      const m = tracker.milestones().find((x) => x.title === s.title)
      if (m) { skip(s, 'the milestone exists'); continue }
      await write(async () => { const c = tracker.createMilestone({ title: s.title, description: `Release ${s.title} (${s.date}). ${MARKER}` }); tracker.updateMilestone(c.number, { state: 'closed' }) })
      applied.push({ id: s.id, did: `created the closed milestone ${s.title}` })
    } else if (s.kind === 'issue-link') {
      const done = (tracker.comments(s.issue) ?? []).some((c) => c.body.includes(MARKER) && c.body.includes(`#${s.pr}`))
      if (done) { skip(s, 'already linked'); continue }
      await write(() => tracker.comment(s.issue, `Shipped in #${s.pr} (recorded by agent-os retrofit). ${MARKER}`))
      applied.push({ id: s.id, did: `linked #${s.pr} on #${s.issue}` })
    } else if (s.kind === 'pr-title' || s.kind === 'pr-body') {
      const pr = prs.get(s.pr)
      if (!pr || pr.state !== 'open') { skip(s, 'not open any more: closed change requests are never rewritten'); continue }
      if (s.kind === 'pr-title') {
        if (!s.to) { skip(s, 'no automatic title: the author renames it'); continue }
        if (pr.title === s.to) { skip(s, 'already normalized'); continue }
        await write(() => tracker.updatePullRequest(s.pr, { title: s.to }))
        applied.push({ id: s.id, did: `retitled #${s.pr}: ${s.to}` })
      } else {
        const lacking = s.add.filter((h) => !new RegExp(`^##\\s+${h}\\s*$`, 'mi').test(pr.body))
        if (!lacking.length || pr.body.includes(MARKER)) { skip(s, 'the sections are there'); continue }
        const body = `${pr.body.replace(/\s*$/, '')}\n\n${lacking.map((h) => `## ${h}\n\n<!-- added by agent-os retrofit: fill it in -->`).join('\n\n')}\n\n${MARKER}\n`
        await write(() => tracker.updatePullRequest(s.pr, { body }))
        applied.push({ id: s.id, did: `added ${lacking.join(', ')} to #${s.pr}` })
      }
    } else if (s.kind === 'journal') {
      if (readJournal(cwd).some((e) => e.title === s.title)) { skip(s, 'the baseline entry exists'); continue }
      if (!dryRun) addEntry(cwd, { type: 'note', title: s.title, body: `${s.body}\n`, refs: [], areas: ['history'], author: author ?? 'agent-os', at: now, lang: languageFor(config, 'journal') })
      applied.push({ id: s.id, did: 'wrote the baseline journal entry' })
    } else skip(s, `unknown step kind ${s.kind}`)
  }
  return { applied, skipped, dryRun }
}

export const loadPlan = (cwd) => {
  const file = join(cwd, PLAN_FILE)
  if (!existsSync(file)) throw new CliError(`there is no ${PLAN_FILE}`, { hint: 'agent-os retrofit plan writes it; review it, then apply' })
  return JSON.parse(readFileSync(file, 'utf8'))
}
