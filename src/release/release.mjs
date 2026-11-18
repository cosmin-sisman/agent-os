// The release flow (/release): integration → production through a release change request merged with a merge commit
// (never squashed), a tag on that merge, the platform release with the grouped notes, the rolling milestone rolled,
// release checks, and a change request that syncs the release branch back into integration. Every step checks what
// already exists first, so a rerun continues where it stopped. Risky contents (destructive migrations, new
// environment variables) stop the release until someone accepts them explicitly. Design §7.

import { CliError } from '../cli/errors.mjs'
import { releaseBlockers } from '../security/digest.mjs'
import { threatModelStale } from '../security/threats.mjs'
import { checkEnvironment } from '../env/checks.mjs'
import { systemProbe } from '../env/probe.mjs'
import { runSuites } from '../gate/gate.mjs'
import { languageFor, milestone } from '../i18n/i18n.mjs'
import { addEntry } from '../journal/journal.mjs'
import { compareVersions } from '../migrations/runner.mjs'
import { readiness } from '../workflow/ship.mjs'
import { readLessons } from '../lessons/lessons.mjs'
import { changelogEntry, notesMarkdown, releaseNotes } from './notes.mjs'
import { parse, stringify } from '../yaml/yaml.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ok = (r) => r.status === 0
/** Marks the change request release finish opens to bring production back into integration (#240). */
export const SYNC_MARKER = '<!-- agent-os:sync -->'
const out = (r) => (ok(r) ? r.stdout.trim() : null)
const must = (git, args) => { const r = git(args); if (!ok(r)) throw new CliError(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim().split('\n')[0]}`); return r.stdout.trim() }

const MIGRATION_PATH = /(^|\/)(migrations?|migrate|db|database|prisma|schema)\/|\.sql$/i
const DESTRUCTIVE = /\b(DROP\s+(TABLE|COLUMN|SCHEMA|DATABASE|INDEX|VIEW)|TRUNCATE(\s+TABLE)?|DELETE\s+FROM|ALTER\s+TABLE\s+\S+\s+(DROP|RENAME)|RENAME\s+(TABLE|COLUMN)|dropTable|dropColumn|removeColumn|renameColumn)\b/i

/** The rolling milestone pattern ("Stage 0 - Release {n} (in progress)") as a RegExp with the number captured. */
const rollingPattern = (lang) => new RegExp(`^${milestone('rolling-release', lang, { n: '__N__' }).title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('__N__', '(\\d+)')}$`)

/** Contents that need a person to accept them before production: destructive migrations and new variables. */
export function releaseRisks(git, { from, head }) {
  const files = (out(git(['diff', '--name-only', '--diff-filter=AM', `${from}..${head}`])) ?? '').split(/\r?\n/).filter(Boolean)
  const risks = []
  for (const f of files.filter((p) => MIGRATION_PATH.test(p))) {
    const text = out(git(['show', `${head}:${f}`])) ?? ''
    const m = text.match(DESTRUCTIVE)
    if (m) risks.push({ id: `destructive:${f}`, kind: 'destructive', file: f, detail: `${f} contains "${m[0]}": back up the data and confirm the rollback before production` })
  }
  const added = (out(git(['diff', `${from}..${head}`, '--', '.env.example', '.env.sample', 'env.example'])) ?? '').split(/\r?\n/).map((l) => l.match(/^\+\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1]).filter(Boolean)
  const env = (ref) => { try { return JSON.parse(out(git(['show', `${ref}:agent-os.json`])) ?? '{}').requires?.env ?? [] } catch { return [] } }
  const before = new Set(env(from))
  for (const name of [...new Set([...added, ...env(head).filter((n) => !before.has(n))])]) risks.push({ id: `env:${name}`, kind: 'env', name, detail: `new variable ${name}: set it in production before the deploy` })
  return risks
}

/**
 * The plan for a release; it only reads.
 * @param {{ git: Function, tracker: object, cwd: string, config: object, vocab: object }} deps
 */
/** The version in package.json, and in package-lock.json when there is one; null without a package.json. */
export function packageVersions(cwd) {
  const read = (f) => { try { return JSON.parse(readFileSync(join(cwd, f), 'utf8')) } catch { return null } }
  const pkg = read('package.json')
  if (!pkg?.version) return null
  const lock = read('package-lock.json')
  return { package: pkg.version, lock: lock ? lock.version ?? lock.packages?.['']?.version ?? null : null }
}

/**
 * Sets package.json (and package-lock.json) to the released version, keeping each file's indentation. Returns the
 * files it changed: they go into the release commit, so the tag and the package agree (#58).
 */
export function bumpPackage(cwd, version) {
  const changed = []
  for (const f of ['package.json', 'package-lock.json']) {
    const file = join(cwd, f)
    let text
    try { text = readFileSync(file, 'utf8') } catch { continue }
    const data = JSON.parse(text)
    const indent = text.match(/^\{\r?\n([ \t]+)"/)?.[1] ?? '  '
    let touched = false
    if (data.version !== undefined && data.version !== version) { data.version = version; touched = true }
    if (f === 'package-lock.json' && data.packages?.[''] && data.packages[''].version !== version) { data.packages[''].version = version; touched = true }
    if (touched) { writeFileSync(file, `${JSON.stringify(data, null, indent)}\n`); changed.push(f) }
  }
  return changed
}

export function planRelease(deps, { version, hotfix = false }) {
  const { git, tracker, config } = deps
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new CliError('--version is required, as x.y.z')
  const { integration, production } = config.branches
  must(git, ['fetch', '--tags', 'origin', integration, production])
  const head = `origin/${hotfix ? production : integration}`
  const tag = `v${version}`
  const tagged = out(git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]))
  // On a rerun after tagging, the range still starts at the release before this one, so the notes stay complete.
  const lastTag = out(git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', tagged ? `${tag}^` : `origin/${production}`]))
  const from = lastTag ?? out(git(['rev-list', '--max-parents=0', head]))?.split(/\r?\n/)[0]
  const problems = []
  if (lastTag && compareVersions(version, lastTag.replace(/^v/, '')) <= 0) problems.push(`${version} is not after the last release ${lastTag}`)
  const notes = releaseNotes(deps, { from, to: tagged ? tag : head, version })
  problems.push(...notes.problems)
  // package.json lags behind until release open bumps it; after tagging, a mismatch means the tag will not publish.
  const pkg = packageVersions(deps.cwd)
  const warnings = []
  if (tagged) {
    // After tagging, what counts is the tagged commit's package.json: a mismatch there means the tag will not publish.
    let atTag = null
    try { atTag = JSON.parse(out(git(['show', `${tag}:package.json`])) ?? 'null')?.version ?? null } catch { /* no package.json at the tag */ }
    if (atTag && atTag !== version) problems.push(`package.json at ${tag} is ${atTag}, not ${version}: the tag does not match the package, so it will not publish`)
  } else {
    if (pkg && pkg.package !== version) warnings.push(`package.json is at ${pkg.package}, not ${version}: release open sets it in the release commit`)
    if (pkg?.lock && pkg.lock !== version) warnings.push(`package-lock.json is at ${pkg.lock}, not ${version}: release open sets it too`)
  }
  const lang = languageFor(config, 'milestones')
  const rolling = tracker.milestones().filter((m) => m.state === 'open').map((m) => ({ m, n: Number(m.title.match(rollingPattern(lang))?.[1]) })).find((x) => x.n)
  const n = rolling?.n ?? 1
  return {
    version, tag, tagged: Boolean(tagged), hotfix, from, head, lastTag, branch: hotfix ? null : `release/${version}`,
    title: `release-${n}: ${version}`, milestone: rolling ? { number: rolling.m.number, title: rolling.m.title, n } : null,
    notes, risks: releaseRisks(git, { from, head }), problems, warnings, package: pkg,
    // /retro runs at every release: the plan says how many lessons wait (design §10).
    inbox: readLessons(deps.cwd).filter((c) => c.state === 'inbox').length,
  }
}

/** The release change request's description: notes, risks as Before merge items, and how to roll back. */
export function releaseBody(plan, vocab) {
  return [
    `## What\n\nRelease ${plan.version} (${plan.tag}): \`${plan.from?.slice?.(0, 12) ?? plan.from}\`..\`${plan.head}\` into production. Merged with a merge commit by \`agent-os release finish\`, never squashed.`,
    notesMarkdown(plan.notes, vocab).replace(/^## /gm, '### '),
    `## Risks\n\n${plan.risks.length ? plan.risks.map((r) => `- **${r.kind}**: ${r.detail}`).join('\n') : '_None found (no destructive migration, no new variable)._'}`,
    `## How it was tested\n\nEvery change request in this release passed its own checks; this one runs them again on the release branch. \`agent-os release finish\` runs the release checks after tagging.`,
    `## Lessons\n\nNone: a release; lessons live in the change requests it contains.`,
    ...(plan.risks.length ? [`## Before merge\n\n${plan.risks.map((r) => `- [ ] ${r.id}`).join('\n')}`] : []),
  ].join('\n\n')
}

const checked = (body, id) => new RegExp(`^\\s*[-*]\\s+\\[[xX]\\]\\s+${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(body ?? '')

/** Opens or updates the release branch and its change request. Safe to rerun. */
export function openRelease(deps, { version, author = 'agent-os', now = new Date(), dryRun = false }) {
  const { git, tracker, cwd, config, vocab } = deps
  const plan = planRelease(deps, { version })
  const { integration, production } = config.branches
  // The release branch must start from a descendant of production, or its change request conflicts and the platform
  // runs no checks on it (#240): a squashed or missing sync is caught here, with the fix.
  if (!ok(git(['merge-base', '--is-ancestor', `origin/${production}`, `origin/${integration}`]))) {
    plan.problems.push(`${production} is not an ancestor of ${integration}: the last release was not synced back with a merge commit, so the release ${vocab.changeRequest} would conflict. Open a ${vocab.changeRequest} from ${production} into ${integration} and merge it with a merge commit (agent-os ship merges syncs that way), then run release open again`)
  }
  if (plan.problems.length) return { opened: false, plan, problems: plan.problems }
  const body = releaseBody(plan, vocab)
  const existing = tracker.findPullRequest({ head: plan.branch, base: production })
  const remote = ok(git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${plan.branch}`]))
  const steps = [remote ? `reuse ${plan.branch}` : `create ${plan.branch} from origin/${integration} with the changelog entry, a release journal entry${plan.package && plan.package.package !== version ? ` and package.json at ${version}` : ''}`, existing ? `update ${vocab.cr} ${vocab.crRef}${existing.number}` : `open "${plan.title}" from ${plan.branch} into ${production}`]
  if (dryRun) return { opened: false, dryRun: true, plan, steps, body }
  if (!remote) {
    const start = must(git, ['rev-parse', '--abbrev-ref', 'HEAD'])
    must(git, ['switch', '-c', plan.branch, `origin/${integration}`])
    try {
      const file = join(cwd, 'changelog.yaml')
      let text = ''
      try { text = readFileSync(file, 'utf8') } catch { /* new */ }
      const header = text.split(/\r?\n/).filter((l) => l.startsWith('#')).join('\n')
      const releases = (parse(text || 'releases: []')?.releases ?? []).filter((r) => r.version !== version)
      writeFileSync(file, `${header ? `${header}\n` : ''}${stringify({ releases: [changelogEntry(plan.notes, { date: now.toISOString().slice(0, 10) }), ...releases] })}`)
      const entry = addEntry(cwd, { type: 'release', title: `Release ${version}`, areas: ['release'], refs: [], author, at: now, body: `${plan.from}..${plan.head}. ${Object.entries(plan.notes.groups).filter(([, l]) => l.length).map(([g, l]) => `${l.length} ${g}`).join(', ') || 'no change requests'}.${plan.risks.length ? ` Risks: ${plan.risks.map((r) => r.id).join(', ')}.` : ''}` })
      if (entry.problems) throw new CliError(`journal entry: ${entry.problems.join('; ')}`)
      const bumped = bumpPackage(cwd, version)
      must(git, ['add', 'changelog.yaml', entry.path, ...bumped])
      must(git, ['commit', '-m', `chore(release): ${version}`])
      must(git, ['push', '-u', 'origin', plan.branch])
    } finally { git(['switch', start]) }
  }
  const cr = existing ? { ...tracker.updatePullRequest(existing.number, { title: plan.title, body }), number: existing.number } : tracker.createPullRequest({ title: plan.title, body, head: plan.branch, base: production })
  // A conflicting change request gets no checks at all on GitHub: say so instead of leaving it silent.
  let conflicts = false
  try { conflicts = tracker.pullRequestStatus(cr.number)?.mergeable === 'CONFLICTING' } catch { /* status unknown yet: nothing to report */ }
  return { opened: true, plan, steps, changeRequest: { number: cr.number, url: cr.url ?? existing?.url ?? null }, updated: Boolean(existing), conflicts }
}

/**
 * Merges the release (merge commit, pinned), tags it, publishes the notes, rolls the milestone, runs the release checks
 * and opens the sync back into integration. Each step is skipped when already done.
 */
export function finishRelease(deps, { version, hotfix = false, accept = [], now = new Date(), probe, exec, dryRun = false }) {
  const { git, tracker, cwd, config, vocab } = deps
  const { integration, production } = config.branches
  const plan = planRelease(deps, { version, hotfix })
  const problems = [...plan.problems]
  let status = null
  let cr = null
  if (!hotfix) {
    cr = tracker.findPullRequest({ head: plan.branch, base: production })
    if (!cr && !plan.tagged) problems.push(`no open release ${vocab.changeRequest}: run agent-os release open --version ${version}`)
    if (cr) {
      status = tracker.pullRequestStatus(cr.number)
      problems.push(...readiness(status, config).filter((r) => r.owner !== 'body').map((r) => r.problem))
    }
  }
  const asks = plan.risks.filter((r) => !accept.includes(r.id) && !accept.includes(r.kind) && !checked(status?.body, r.id))
  for (const r of asks) problems.push(`ask first: ${r.detail} (accept with --accept ${r.id}, or tick it under Before merge)`)
  // The KEV gate (#108): a known-exploited vulnerability in a shipped dependency stops the release, unless the owners
  // accepted the risk in writing (security.acceptedRisks). It reads the last watch; it never goes to the network.
  for (const v of releaseBlockers(cwd)) problems.push(`known exploited: ${v.id}${v.aliases.length ? ` (${v.aliases[0]})` : ''} in ${v.touched.filter((p) => !p.dev).map((p) => `${p.name}@${p.version}`).join(', ')}${v.fixed ? `; fixed in ${v.fixed}` : ''}: update it, or record the accepted risk in security.acceptedRisks (id, reason, by)`)
  // Threat-model freshness (#110): a threat model that no longer matches stack.yaml is refreshed before the release.
  const tm = threatModelStale(cwd)
  if (tm?.stale.length) problems.push(`the threat model ${tm.id} is stale (${tm.stale.join(', ')} changed): run agent-os security threat-model and commit it`)
  const steps = [
    ...(hotfix ? [] : [cr ? `merge ${vocab.crRef}${cr.number} into ${production} with a merge commit (never squashed)` : plan.tagged ? 'the release is already merged and tagged' : `open the release ${vocab.changeRequest} first (agent-os release open --version ${version})`]),
    plan.tagged ? `${plan.tag} already exists` : `tag ${plan.tag} on ${production}`,
    `publish the ${vocab.platform} release ${plan.tag} with the notes`,
    plan.milestone && !plan.tagged ? `close "${plan.milestone.title}" as "${milestone('closed-release', languageFor(config, 'milestones'), { n: plan.milestone.n, date: now.toISOString().slice(0, 10) }).title}" and open Release ${plan.milestone.n + 1}` : 'make sure the next rolling milestone exists',
    'run the release checks (environment, release:* suites)',
    `open the sync of ${production} back into ${integration} (merged with a merge commit; no branch is deleted)`,
  ]
  if (problems.length || dryRun) return { released: false, dryRun, plan, steps, problems, asks: asks.map((a) => a.id) }

  if (!hotfix && cr) {
    const merged = tracker.mergePullRequest(cr.number, { method: 'merge', sha: status.head })
    if (!merged.merged) throw new CliError(`the release ${vocab.changeRequest} was not merged`, { hint: 'agent-os pr status' })
  }
  must(git, ['fetch', '--tags', 'origin', production])
  const sha = must(git, ['rev-parse', `origin/${production}`])
  const tag = tracker.createTag(plan.tag, plan.tagged ? must(git, ['rev-list', '-n', '1', plan.tag]) : sha)
  const release = tracker.publishRelease({ tag: plan.tag, name: `${plan.tag}`, body: notesMarkdown(plan.notes, vocab) })
  const lang = languageFor(config, 'milestones')
  let rolled = null
  // The roll belongs to the run that created the tag: a rerun must not close the milestone it just opened.
  if (plan.milestone && tag.created) {
    const closed = milestone('closed-release', lang, { n: plan.milestone.n, date: now.toISOString().slice(0, 10) })
    tracker.updateMilestone(plan.milestone.number, { title: closed.title, description: closed.description, state: 'closed' })
    rolled = closed.title
  }
  const nextN = (plan.milestone?.n ?? 0) + (tag.created ? 1 : 0) || 1
  const next = milestone('rolling-release', lang, { n: nextN })
  if (!tracker.milestones().some((m) => m.title === next.title)) tracker.createMilestone(next)
  const env = checkEnvironment(config, { cwd, probe: probe ?? systemProbe(process.env), mode: 'ci' })
  const suites = Object.keys(config.gate ?? {}).filter((s) => s.startsWith('release:'))
  const checks = runSuites(config, suites, { cwd, exec })
  // The sync comes from production itself: only that brings its release merge commit into integration, so the next
  // release branch starts from a descendant of production and does not conflict (#240). ship merges it with a merge
  // commit, never squashed; the marker tells it this is a sync.
  const syncHead = production
  const existingSync = tracker.findPullRequest({ head: syncHead, base: integration })
  const sync = existingSync ?? tracker.createPullRequest({ title: `chore(release): sync ${plan.tag} into ${integration}`, body: `${SYNC_MARKER}\n## What\n\nBrings ${production} (${plan.tag}) back into ${integration}: the release merge commit, the changelog entry, the release journal entry${hotfix ? ' and the hotfix' : ''}.\n\n## Why\n\nThe release (${plan.tag}) is on ${production}; ${integration} must contain it, or the next release conflicts. Merge it with a merge commit (agent-os ship does), never squashed.\n\n## How it was tested\n\nThe release checks ran after tagging.\n\n## Lessons\n\nNone: the release sync.`, head: syncHead, base: integration })
  return { released: true, plan, sha, tag, release, milestone: { closed: rolled, opened: next.title }, checks: { env: env.summary, suites: checks.map((s) => ({ name: s.name, passed: s.passed })) }, sync: { number: sync.number, url: sync.url ?? null, existed: Boolean(existingSync) } }
}
