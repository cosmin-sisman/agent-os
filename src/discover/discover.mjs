// /discover (design §11, profile `active`): infer the conventions an active repository already follows, so the rules
// reflect them instead of overriding them. It looks at commit style, branch naming, the merge strategy and areas from
// the history, drafts the AGENTS.md area map, and extracts decisions from pull or merge request discussions as
// journal drafts. Every proposal cites its evidence (counts and examples); one without evidence is dropped. Nothing
// is written until the person accepts a proposal by id (`discover apply`).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { nodeFor } from '../config/config.mjs'

export const PLAN_FILE = '.agent-os/cache/discover.json'
const CONVENTIONAL = /^([a-z]+)(\(([^)]+)\))?!?: \S/
/** Common branch prefixes and the issue type each one serves. */
const PREFIX_TYPE = { feat: 'feature', feature: 'feature', features: 'feature', fix: 'bug', bugfix: 'bug', bug: 'bug', hotfix: null, docs: 'docs', doc: 'docs', chore: 'chore', refactor: 'chore', research: 'research', spike: 'research' }
const DEFAULT_PREFIX = { feature: 'feat', bug: 'fix', docs: 'docs', chore: 'chore', research: 'chore' }
const DECISION = /(we decided|decided to|decision:|we('| wi)ll go with|going with|agreed (to|on|that)|we chose|chose .{2,40} over|instead of|am decis|am ales|mergem pe)/i
const pct = (n, d) => Math.round((100 * n) / Math.max(1, d))
const top = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

/** Commit subjects and parent counts of the last `n` first-parent commits. */
function history(git, n) {
  const r = git(['log', '--first-parent', `-n${n}`, '--format=%s%x1f%P'])
  if (r.status !== 0) throw new CliError('cannot read the git history', { hint: 'run /discover inside a git repository with commits' })
  return String(r.stdout).split(/\r?\n/).filter(Boolean).map((l) => { const [subject, parents = ''] = l.split('\x1f'); return { subject, merge: parents.trim().split(/\s+/).length > 1 } })
}

/** Commit style: Conventional Commits or not, the types and scopes in use, and how issues are referenced. */
export function commitStyle(commits) {
  const own = commits.filter((c) => !c.merge)
  const conv = own.map((c) => c.subject.match(CONVENTIONAL)).filter(Boolean)
  const types = {}
  const scopes = {}
  for (const m of conv) { types[m[1]] = (types[m[1]] ?? 0) + 1; if (m[3]) scopes[m[3]] = (scopes[m[3]] ?? 0) + 1 }
  const bracket = own.filter((c) => /\[#\d+(, ?#\d+)*\]/.test(c.subject)).length
  const paren = own.filter((c) => /\(#\d+\)\s*$/.test(c.subject)).length
  return { total: own.length, conventional: conv.length, types, scopes, refs: { bracket, paren }, examples: conv.slice(0, 3).map((m) => m.input) }
}

/** Branch prefixes from the change requests' head branches and the remote branches. */
export function branchPrefixes(names) {
  const counts = {}
  const examples = {}
  for (const n of names) {
    const m = String(n).match(/^([a-z][a-z0-9._-]*)\//i)
    if (!m) continue
    const p = m[1].toLowerCase()
    counts[p] = (counts[p] ?? 0) + 1
    ;(examples[p] ??= []).length < 3 && examples[p].push(n)
  }
  return { counts, examples, total: names.length }
}

/** The merge strategy, from the first-parent history: merge commits, or squashed commits that end with (#N). */
export function mergeStrategy(commits) {
  const merges = commits.filter((c) => c.merge && /^Merge (pull request|branch)|^Merge .* into /i.test(c.subject)).length
  const squashed = commits.filter((c) => !c.merge && /\(#\d+\)\s*$/.test(c.subject)).length
  return { merges, squashed, total: commits.length }
}

/** Top-level areas: tracked files per top folder, and the commit scopes that name each. */
export function areas(git, scopes = {}) {
  const r = git(['ls-files'])
  const files = r.status === 0 ? String(r.stdout).split(/\r?\n/).filter(Boolean) : []
  const dirs = {}
  for (const f of files) { const i = f.indexOf('/'); if (i > 0 && !f.startsWith('.')) { const d = f.slice(0, i); dirs[d] = (dirs[d] ?? 0) + 1 } }
  return top(dirs).map(([dir, count]) => ({ dir, files: count, scopes: Object.keys(scopes).filter((s) => s === dir || dir.startsWith(s) || s.startsWith(dir.replace(/s$/, ''))) }))
}

/** Decision candidates in merged change requests: the sentence that states it, its number, title and date. */
export function decisionsFrom(prs) {
  const out = []
  for (const p of prs.filter((x) => x.merged)) {
    const sentences = String(p.body ?? '').replace(/<!--[\s\S]*?-->/g, '').split(/(?<=[.!?])\s+|\r?\n/).map((s) => s.replace(/^[-*>#\s]+/, '').trim()).filter((s) => s.length > 12 && s.length < 400)
    const hit = sentences.find((s) => DECISION.test(s))
    if (hit) out.push({ number: p.number, title: p.title, author: p.author ?? null, areas: (p.labels ?? []).filter((l) => /^area:/i.test(l)).map((l) => l.slice(5)), quote: hit, date: (p.mergedAt ?? p.createdAt ?? '').slice(0, 10) || null })
  }
  return out
}

/**
 * The proposals: each with an id, what it would change, and the evidence behind it. Rules without evidence are not
 * proposed at all (the acceptance criterion: every inferred rule cites its evidence).
 */
export function discoverPlan({ git, tracker, commits: n = 500 }) {
  const commits = history(git, n)
  const style = commitStyle(commits)
  const prs = tracker.allPullRequests({ max: 500 })
  const remote = git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'])
  const branchNames = [...new Set([...prs.map((p) => p.head).filter(Boolean), ...(remote.status === 0 ? String(remote.stdout).split(/\r?\n/).map((b) => b.replace(/^origin\//, '')).filter((b) => b && b !== 'HEAD' && b !== 'origin') : [])])]
  const branches = branchPrefixes(branchNames)
  const merge = mergeStrategy(commits)
  const proposals = []

  if (style.total && pct(style.conventional, style.total) >= 60) {
    // The rule reflects the history and never narrows it: types in use that the defaults lack are added to them.
    const defaults = nodeFor('conventions.types').default
    const extra = top(style.types).filter(([t, c]) => c >= 2 && !defaults.includes(t)).map(([t]) => t)
    proposals.push({ id: 'commit-types', ...(extra.length ? { kind: 'config', key: 'conventions.types', value: [...defaults, ...extra] } : { kind: 'note' }), rule: extra.length ? `commit subjects use Conventional Commits, with the types ${extra.join(', ')} beyond the defaults: add them` : 'commit subjects use Conventional Commits; every type in use is already allowed', evidence: [`${style.conventional} of ${style.total} commit subjects (${pct(style.conventional, style.total)}%) are type(scope): summary`, `types: ${top(style.types).map(([t, c]) => `${t} ${c}`).join(', ')}`, ...style.examples.map((e) => `e.g. "${e}"`)] })
  } else if (style.total) {
    proposals.push({ id: 'commit-style', kind: 'note', rule: 'commit subjects do not follow Conventional Commits yet: the title check would fail most of them; start in adoption mode, or exempt the old style', evidence: [`${style.conventional} of ${style.total} commit subjects (${pct(style.conventional, style.total)}%) are type(scope): summary`] })
  }
  if (style.refs.bracket + style.refs.paren > 0) proposals.push({ id: 'issue-refs', kind: 'note', rule: style.refs.bracket >= style.refs.paren ? 'subjects end with the issues in brackets, like [#12]' : 'subjects end with the change request number, like (#12): squash merges', evidence: [`[#N] in ${style.refs.bracket} subject(s), (#N) at the end of ${style.refs.paren}`] })

  const byType = {}
  for (const [p, c] of Object.entries(branches.counts)) { const t = PREFIX_TYPE[p]; if (t) (byType[t] ??= []).push([p, c]) }
  const prefixes = {}
  const evidence = []
  for (const [type, list] of Object.entries(byType)) {
    const [best, count] = list.sort((a, b) => b[1] - a[1])[0]
    evidence.push(`${type}: ${list.map(([p, c]) => `${p}/ ${c}`).join(', ')} (e.g. ${branches.examples[best].join(', ')})`)
    if (best !== DEFAULT_PREFIX[type] && count >= 2) prefixes[type] = best
  }
  if (Object.keys(prefixes).length) proposals.push({ id: 'branch-prefixes', kind: 'config', key: 'branches.prefixes', value: prefixes, rule: `branches are named ${Object.entries(prefixes).map(([t, p]) => `${p}/<n>-<slug> for a ${t}`).join(', ')}; agent-os start keeps that`, evidence: [`${branchNames.length} branch name(s) from change requests and the remote`, ...evidence] })

  if (merge.merges + merge.squashed >= 3) {
    const method = merge.squashed >= merge.merges ? 'squash' : 'merge'
    proposals.push({ id: 'merge-method', kind: 'config', key: 'branches.mergeMethod', value: method, rule: `change requests are ${method === 'squash' ? 'squash-merged' : 'merged with a merge commit'}`, evidence: [`of the last ${merge.total} first-parent commits: ${merge.merges} merge commit(s), ${merge.squashed} squashed commit(s) ending with (#N)`] })
  }

  const areaRows = areas(git, style.scopes)
  if (areaRows.length) proposals.push({ id: 'area-map', kind: 'area-map', rule: 'a draft of the AGENTS.md area map, one row per top-level folder; each "What" is described by a subagent that reads that area', rows: areaRows, evidence: areaRows.map((a) => `${a.dir}/: ${a.files} tracked file(s)${a.scopes.length ? `, commit scopes ${a.scopes.join(', ')}` : ''}`) })

  for (const d of decisionsFrom(prs)) proposals.push({ id: `decision:${d.number}`, kind: 'decision', rule: `a decision journal entry from #${d.number} "${d.title}"`, entry: { title: d.title, author: d.author, areas: d.areas.length ? d.areas : ['history'], body: `From #${d.number}${d.date ? ` (merged ${d.date})` : ''}:\n\n> ${d.quote}`, refs: [`#${d.number}`] }, evidence: [`#${d.number}: "${d.quote}"`] })

  return { commits: style.total, changeRequests: prs.length, branches: branchNames.length, proposals: proposals.filter((p) => p.evidence?.length) }
}

/** The area map draft as a Markdown table for AGENTS.md (the "What" column is for the area subagents to fill). */
export function areaMapDraft(rows) {
  return ['| Path | What |', '|---|---|', ...rows.map((r) => `| \`${r.dir}/\` | to describe (${r.files} files${r.scopes.length ? `; scopes: ${r.scopes.join(', ')}` : ''}) |`)].join('\n')
}

export function savePlan(cwd, plan) {
  mkdirSync(join(cwd, '.agent-os/cache'), { recursive: true })
  writeFileSync(join(cwd, PLAN_FILE), `${JSON.stringify(plan, null, 2)}\n`)
}

export function readPlan(cwd) {
  const f = join(cwd, PLAN_FILE)
  if (!existsSync(f)) throw new CliError('there is no discover plan to apply', { hint: 'agent-os discover plan, review it, then agent-os discover apply --accept <id>…' })
  return JSON.parse(readFileSync(f, 'utf8'))
}
