// /ship: merge a green, reviewed change request, then make the tracker tell the truth. Issues it closes are closed
// (explicitly: the platform only auto-closes into the default branch) with a comment and set to Done; issues it only
// references stay open with a progress comment, and are reopened if something closed them. Then the branch and its
// worktree are removed. A change request that is behind or conflicting goes back to its author.

import { CliError } from '../cli/errors.mjs'
import { issueRefs } from '../conventions/conventions.mjs'
import { has } from '../platform/capabilities.mjs'
import { section } from './pr.mjs'
import { untickedScenarios } from '../testing/test.mjs'

const BEFORE_MERGE = { en: 'Before merge', ro: 'Inainte de merge' }

/** Unchecked "- [ ]" items in the body's "Before merge" section. */
export function uncheckedBeforeMerge(body, lang = 'en') {
  const text = section(body, BEFORE_MERGE[lang] ?? BEFORE_MERGE.en) ?? section(body, BEFORE_MERGE.en) ?? ''
  return text.split(/\r?\n/).map((l) => l.match(/^\s*[-*]\s+\[ \]\s+(.+)$/)?.[1]?.trim()).filter(Boolean)
}

/**
 * Why a change request cannot be merged yet. `author` problems are the author's to fix (behind, conflicts).
 * @returns {{ problem: string, owner: 'author' | 'reviewer' | 'checks' | 'body' | 'config' }[]}
 */
export function readiness(status, config, { lang = 'en' } = {}) {
  const out = []
  const add = (owner, problem) => out.push({ owner, problem })
  if (status.state !== 'open') add('config', `it is ${status.state}`)
  if (status.draft) add('author', 'it is a draft')
  const bases = [config.branches.integration, config.branches.production]
  if (status.base && !bases.includes(status.base)) add('config', `it targets ${status.base}, not ${bases.join(' or ')}`)
  if (status.checks === 'none') add('checks', 'no checks reported on its last commit')
  else if (status.checks === 'pending') add('checks', `checks still running: ${status.pending.join(', ')}`)
  else if (status.checks === 'failure') add('checks', `failing checks: ${status.failing.map((c) => c.name).join(', ')}`)
  for (const name of config.branches.requiredChecks ?? []) {
    const c = status.all.find((x) => x.name === name)
    if (!c) add('checks', `the required check "${name}" did not run`)
    else if (c.state !== 'success' && status.checks === 'success') add('checks', `the required check "${name}" is ${c.state}`)
  }
  if (status.review === 'CHANGES_REQUESTED') add('author', 'changes are requested')
  else if ((config.branches.requiredApprovals ?? 0) > 0 && status.review !== 'APPROVED') add('reviewer', `it needs ${config.branches.requiredApprovals} approving review(s)`)
  if (status.mergeable === 'CONFLICTING' || status.mergeState === 'DIRTY') add('author', `it conflicts with ${status.base}`)
  else if (status.mergeState === 'BEHIND') add('author', `it is behind ${status.base}`)
  for (const item of uncheckedBeforeMerge(status.body, lang)) add('body', `"Before merge" item not done: ${item}`)
  return out
}

const TEXT = {
  en: {
    closed: (cr) => `Shipped in ${cr}.`,
    stays: (cr) => `${cr} is merged and is part of this issue, which stays open.`,
    related: (cr) => `${cr} is merged; it follows up on this issue.`,
    reopened: (cr) => `Reopened: ${cr} only references this issue (Refs), so it is not done yet.`,
    back: (who, problems, base) => `@${who}, this cannot be merged yet: ${problems.join('; ')}. Please update it from ${base} and push; /ship will merge it once it is green.`,
  },
  ro: {
    closed: (cr) => `Livrat in ${cr}.`,
    stays: (cr) => `${cr} a fost integrat si face parte din acest issue, care ramane deschis.`,
    related: (cr) => `${cr} a fost integrat; continua acest issue.`,
    reopened: (cr) => `Redeschis: ${cr} doar face referire la acest issue (Refs), deci nu e gata inca.`,
    back: (who, problems, base) => `@${who}, nu se poate integra inca: ${problems.join('; ')}. Te rog actualizeaza din ${base} si fa push; /ship il integreaza cand e verde.`,
  },
}

const ok = (r) => r.status === 0
/**
 * A sync brings production (or a release or hotfix branch) back into integration. It is always merged with a merge
 * commit, whatever branches.mergeMethod says: a squash would leave production's history out of integration, and
 * the next release would conflict (#240).
 */
export function isSync(s, config) {
  const { integration = 'development', production = 'main' } = config.branches ?? {}
  if (s.base !== integration) return false
  return String(s.body ?? '').includes('<!-- agent-os:sync -->') || s.branch === production || /^(release|hotfix)\//.test(s.branch ?? '')
}
/**
 * Why a change request's head branch is kept after the merge, or null when ship may delete it: a long-lived branch
 * (integration, production) is never deleted, and neither is any branch a sync comes from (#243).
 */
export function keepReason(s, config) {
  const { integration = 'development', production = 'main' } = config.branches ?? {}
  if ([integration, production].includes(s.branch)) return 'it is a long-lived branch'
  if (isSync(s, config)) return 'it is the source of a sync'
  return null
}
const methodFor = (s, config) => (isSync(s, config) ? 'merge' : config.branches.mergeMethod ?? 'squash')
/** A synchronous pause: ship is synchronous, and the wait is short and bounded. */
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
/** How long to watch referenced issues after the merge: a branch linked to an issue closes it a moment later (#232). */
export const SETTLE = { tries: 4, waitMs: 1500 }

/**
 * @param {{ config: object, tracker: object, caps: object, git: Function, vocab: object }} deps
 * @param {{ number: number, issuesLang?: string, prsLang?: string, notify?: boolean, keepBranch?: boolean, dryRun?: boolean }} options
 */
export function ship({ config, tracker, caps, git, vocab, sleep = pause }, { number, issuesLang = 'en', prsLang = 'en', notify = true, keepBranch = false, dryRun = false, settle = SETTLE }) {
  const s = tracker.pullRequestStatus(number)
  const cr = `${vocab.cr} ${vocab.crRef}${number}`
  const problems = readiness(s, config, { lang: prsLang })
  if (problems.length) {
    const theirs = problems.filter((p) => p.owner === 'author')
    let notified = false
    if (theirs.length && notify && s.author && !dryRun) { tracker.commentChangeRequest(number, (TEXT[prsLang] ?? TEXT.en).back(s.author, theirs.map((p) => p.problem), s.base)); notified = true }
    return { shipped: false, number, problems, notified, backToAuthor: theirs.length > 0 }
  }
  const { closes, refs } = issueRefs(s.body)
  // The scenarios planned into the issues it closes must be ticked: the tests that cover them are in this change.
  const unticked = closes.flatMap((n) => { try { return untickedScenarios(tracker.get(n).body).map((x) => `#${n}: ${x}`) } catch { return [] } })
  if (unticked.length) return { shipped: false, number, problems: [{ owner: 'body', problem: `${unticked.length} test scenario(s) not ticked: ${unticked.slice(0, 3).join('; ')}${unticked.length > 3 ? '; …' : ''} (tick each one the tests cover, or move it to a follow-up issue)` }], notified: false, backToAuthor: false }
  const before = new Map(refs.map((n) => [n, tracker.get(n).state]))
  const t = TEXT[issuesLang] ?? TEXT.en
  const steps = [
    `merge ${cr} into ${s.base} (${methodFor(s, config)}${isSync(s, config) ? ': a sync is never squashed' : ''}, head ${String(s.head).slice(0, 7)})`,
    ...closes.map((n) => `close #${n} with a comment${has(caps, 'board') ? ' and set it to Done' : ''}`),
    ...refs.map((n) => `comment on #${n}${before.get(n) === 'closed' ? ' (already closed)' : '; it stays open'}`),
    ...(keepBranch || s.fork ? [] : keepReason(s, config) ? [`keep the branch ${s.branch}: ${keepReason(s, config)}`] : [`delete the branch ${s.branch}`]),
  ]
  if (dryRun) return { shipped: false, dryRun: true, number, steps, closes, refs }

  const merged = tracker.mergePullRequest(number, { method: methodFor(s, config), sha: s.head, title: s.title })
  if (!merged.merged) throw new CliError(`${cr} was not merged`, { hint: 'agent-os pr status' })
  const issues = []
  for (const n of closes) {
    const i = tracker.get(n)
    if (i.state === 'open') tracker.update(n, { state: 'closed' })
    tracker.comment(n, t.closed(cr))
    if (has(caps, 'board')) tracker.setStatus(n, 'Done')
    issues.push({ number: n, action: i.state === 'open' ? 'closed' : 'already closed' })
  }
  // The platform may close a referenced issue a moment after the merge (a branch created from the issue is linked to
  // it, and GitHub closes linked issues on merge into the default branch). Watch them briefly before deciding.
  const watched = refs.filter((n) => before.get(n) === 'open')
  const states = new Map(refs.map((n) => [n, tracker.get(n).state]))
  for (let i = 1; i < settle.tries && watched.some((n) => states.get(n) === 'open'); i++) {
    sleep(settle.waitMs)
    for (const n of watched) if (states.get(n) === 'open') states.set(n, tracker.get(n).state)
  }
  for (const n of refs) {
    const now = states.get(n)
    if (now === 'closed' && before.get(n) === 'open') { tracker.update(n, { state: 'open' }); tracker.comment(n, t.reopened(cr)); issues.push({ number: n, action: 'reopened' }) }
    else if (now === 'closed') { tracker.comment(n, t.related(cr)); issues.push({ number: n, action: 'commented, already closed' }) }
    else { tracker.comment(n, t.stays(cr)); issues.push({ number: n, action: 'commented, stays open' }) }
  }
  const cleanup = keepBranch || s.fork ? [] : keepReason(s, config) ? [`kept ${s.branch}: ${keepReason(s, config)}`] : cleanBranch({ tracker, git, config }, s.branch)
  return { shipped: true, number, sha: merged.sha, issues, cleanup, warnings: tracker.warnings ?? [] }
}

/** Removes the branch on the remote, its worktree and the local branch (switching away from it first). */
function cleanBranch({ tracker, git, config }, branch) {
  if ([config.branches.integration, config.branches.production].includes(branch)) return [`kept ${branch}: it is a long-lived branch`]
  const done = []
  const remote = tracker.deleteBranch(branch)
  done.push(remote.deleted ? `deleted origin/${branch}` : `origin/${branch} was already gone`)
  const wt = git(['worktree', 'list', '--porcelain'])
  if (ok(wt)) {
    const blocks = wt.stdout.split(/\r?\n\r?\n/)
    const mine = blocks.slice(1).find((b) => b.split(/\r?\n/).includes(`branch refs/heads/${branch}`))
    const path = mine?.match(/^worktree (.+)$/m)?.[1]
    if (path) done.push(ok(git(['worktree', 'remove', path])) ? `removed the worktree ${path}` : `could not remove the worktree ${path} (uncommitted changes?): remove it by hand`)
  }
  if (!ok(git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]))) return done
  if (git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout?.trim() === branch) {
    if (!ok(git(['switch', config.branches.integration]))) { done.push(`still on ${branch}: switch away and delete it by hand`); return done }
    git(['pull', '--ff-only'])
    done.push(`switched to ${config.branches.integration}`)
  }
  done.push(ok(git(['branch', '-D', branch])) ? `deleted the local branch ${branch}` : `could not delete the local branch ${branch}`)
  return done
}
