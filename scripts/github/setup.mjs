// Creates this repository's labels, milestones, epics and issues from plan.mjs, with sub-issues and
// blocked-by relationships. Idempotent: existing labels are updated, existing milestones and issues
// (matched by title) are reused. Usage: node scripts/github/setup.mjs <owner/repo> [--dry-run]

import { execFileSync } from 'node:child_process'
import { labels, milestones, issues } from './plan.mjs'

const repo = process.argv[2]
const dry = process.argv.includes('--dry-run')
if (!repo || !repo.includes('/')) { console.error('usage: setup.mjs <owner/repo> [--dry-run]'); process.exit(2) }

const gh = (args, input) => {
  if (dry && !(args[0] === 'api' && !args.includes('-X') && !args.some((a) => a.startsWith('-f') || a.startsWith('-F')))) {
    console.log('[dry-run] gh', args.join(' ')); return '{}'
  }
  return execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] })
}
const api = (path, fields = [], method) => {
  const args = ['api', path]
  if (method) args.push('-X', method)
  for (const [k, v] of fields) args.push(typeof v === 'number' ? '-F' : '-f', `${k}=${v}`)
  return JSON.parse(gh(args) || '{}')
}

// Labels: replace GitHub's defaults that overlap the type:* taxonomy.
for (const name of ['bug', 'enhancement', 'documentation', 'question']) {
  try { gh(['label', 'delete', name, '--repo', repo, '--yes']) } catch {}
}
for (const [name, color, description] of labels) {
  gh(['label', 'create', name, '--repo', repo, '--color', color, '--description', description, '--force'])
}
console.log(`labels: ${labels.length}`)

// Milestones.
const existingMs = JSON.parse(gh(['api', `repos/${repo}/milestones?state=all&per_page=100`]) || '[]')
const msNumber = {}
for (const [title, description] of milestones) {
  const found = Array.isArray(existingMs) && existingMs.find((m) => m.title === title)
  msNumber[title] = found ? found.number : api(`repos/${repo}/milestones`, [['title', title], ['description', description]]).number
}
console.log(`milestones: ${milestones.length}`)

// Issues.
const listed = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'all', '--limit', '500', '--json', 'number,title']) || '[]')
const existing = Array.isArray(listed) ? listed : []
const byKey = {}
const epicOf = (key) => issues.find((x) => x.key === key)

const list = (xs) => xs.map((x) => `- ${x}`).join('\n')
function body(it) {
  if (it.epic) {
    return `## Goal\n\n${it.goal}\n\n## Why now\n\n${it.why}\n\n## Done when\n\n- [ ] every sub-issue is closed\n- [ ] the design sections it covers match what was built (or the design is updated)\n\n## References\n\n${it.refs}\n`
  }
  const parts = [`## Context\n\n${it.context}`, `## Goal\n\n${it.goal}`]
  const scope = []
  if (it.in?.length) scope.push(`In:\n${list(it.in)}`)
  if (it.out?.length) scope.push(`Out:\n${list(it.out)}`)
  if (scope.length) parts.push(`## Scope\n\n${scope.join('\n\n')}`)
  parts.push(`## Acceptance criteria\n\n${it.ac.map((a) => `- [ ] ${a}`).join('\n')}`)
  if (it.scenarios?.length) parts.push(`## Test scenarios\n\n${it.scenarios.map((s) => `- [ ] ${s}`).join('\n')}`)
  const refs = [`Design: docs/design/overview.md`, `Part of the epic: ${epicOf(it.parent)?.title ?? '—'}`]
  parts.push(`## References\n\n${list(refs)}`)
  return parts.join('\n\n') + '\n'
}

for (const it of issues) {
  const title = it.epic ? `Epic: ${it.title}` : it.title
  const found = existing.find((x) => x.title === title)
  if (found) { byKey[it.key] = found.number; continue }
  const fields = [['title', title], ['body', body(it)], ['milestone', msNumber[it.milestone]]]
  for (const l of it.labels) fields.push(['labels[]', l])
  const created = api(`repos/${repo}/issues`, fields)
  byKey[it.key] = created.number
  console.log(`#${created.number} ${title}`)
}

// Relationships need the issues' database ids.
const idOf = {}
for (const [key, num] of Object.entries(byKey)) idOf[key] = dry ? 0 : api(`repos/${repo}/issues/${num}`).id

const warnings = []
for (const it of issues) {
  if (it.parent) {
    try { api(`repos/${repo}/issues/${byKey[it.parent]}/sub_issues`, [['sub_issue_id', idOf[it.key]]], 'POST') }
    catch (err) { if (!String(err.stderr).match(/already|duplicate sub-issues/i)) warnings.push(`sub-issue #${byKey[it.key]} → #${byKey[it.parent]}: ${String(err.stderr).trim()}`) }
  }
  for (const dep of it.blockedBy ?? []) {
    try { api(`repos/${repo}/issues/${byKey[it.key]}/dependencies/blocked_by`, [['issue_id', idOf[dep]]], 'POST') }
    catch (err) { if (!String(err.stderr).match(/already|exists/i)) warnings.push(`#${byKey[it.key]} blocked by #${byKey[dep]}: ${String(err.stderr).trim()}`) }
  }
}
console.log(warnings.length ? `relationship warnings:\n${warnings.join('\n')}` : 'relationships: ok')
console.log(JSON.stringify(byKey))
