// /start: claim an issue and begin work on it the way the team can see. Assign yourself, create the branch from the
// right base and link it to the issue, move it to In Progress, check it out (in a worktree only when asked).

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { LABELS } from '../i18n/i18n.mjs'
import { has } from '../platform/capabilities.mjs'
import { lessonsForIssue, pathsIn } from '../lessons/lessons.mjs'
import { findOverlap } from '../collab/overlap.mjs'

const TYPE_PREFIX = { feature: 'feat', bug: 'fix', docs: 'docs', chore: 'chore', research: 'chore' }

/** The real git, in a directory. Returns { status, stdout, stderr }. */
export const systemGit = (cwd) => (args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** The type of an issue from its labels (any language), or null. */
export function typeOf(labels) {
  for (const l of labels) {
    const entry = LABELS.find((x) => Object.values(x.name).includes(l) || x.id === l)
    if (entry?.id.startsWith('type:')) return entry.id.slice(5)
  }
  return null
}

/** A short ASCII kebab-case slug from an issue title, without its "<Area>: " prefix. */
export function slugFor(title, maxWords = 5) {
  const words = String(title).replace(/^[^:]{2,40}:\s*/, '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w && !['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'with'].includes(w))
  return words.slice(0, maxWords).join('-') || 'work'
}

/** The branch name for an issue: <type>/<n>-<slug>, or hotfix/<n>-<slug>. */
export function branchFor(issue, { hotfix = false } = {}) {
  const type = typeOf(issue.labels)
  if (type === 'epic') throw new CliError(`#${issue.number} is an epic; start one of its sub-issues`, { hint: `agent-os issue children ${issue.number}` })
  const prefix = hotfix ? 'hotfix' : TYPE_PREFIX[type] ?? 'chore'
  return `${prefix}/${issue.number}-${slugFor(issue.title)}`
}

/**
 * Plans and performs the start of an issue.
 * @param {{ tracker: object, caps: object, config: object, git: (args: string[]) => { status: number, stdout: string, stderr: string }, cwd: string }} deps
 * @param {{ number: number, hotfix?: boolean, worktree?: boolean, force?: boolean, dryRun?: boolean }} options
 */
export function startIssue({ tracker, caps, config, git, cwd }, { number, hotfix = false, worktree = false, force = false, dryRun = false }) {
  const issue = tracker.get(number)
  if (issue.isPullRequest) throw new CliError(`#${number} is a pull request, not an issue`)
  if (issue.state !== 'open') throw new CliError(`#${number} is closed`, { hint: 'reopen it first, or open a new issue with /ticket' })
  const me = tracker.whoami()
  const others = issue.assignees.filter((a) => a !== me)
  if (others.length && !force) {
    return { started: false, reason: 'assigned', assignees: others, message: `#${number} is assigned to ${others.map((a) => `@${a}`).join(', ')}. Ask in its comments before taking it over (for example: "@${others[0]}, may I take this, or pair on it?"), or run again with --force once they agree.` }
  }
  const openParts = tracker.children(number).filter((c) => c.state === 'open')
  if (openParts.length) {
    return { started: false, reason: 'parts', parts: openParts, message: `#${number} is done in parts: start one of its open sub-issues (${openParts.map((c) => `#${c.number}`).join(', ')}). One change request closes one issue.` }
  }
  const branch = branchFor(issue, { hotfix })
  const base = hotfix ? config.branches.production : config.branches.integration
  const steps = []
  const run = (what, fn) => { steps.push(what); if (!dryRun) fn() }
  if (!issue.assignees.includes(me)) run(`assign @${me}`, () => tracker.assign(number, [me]))
  if (has(caps, 'linkedBranches')) {
    run(`create ${branch} from ${base} and link it to #${number}`, () => tracker.linkBranch(number, { branch, base }))
    run(`fetch ${branch}`, () => mustGit(git, ['fetch', 'origin', branch]))
  } else {
    run(`create ${branch} from origin/${base} (the platform links it through "Closes #${number}")`, () => { mustGit(git, ['fetch', 'origin', base]); mustGit(git, ['branch', branch, `origin/${base}`]) })
  }
  const worktreePath = join('.claude', 'worktrees', branch.replace(/\//g, '-'))
  if (worktree) run(`check it out in a worktree at ${worktreePath}`, () => mustGit(git, ['worktree', 'add', worktreePath, branch]))
  else run(`check out ${branch}`, () => mustGit(git, ['switch', branch]))
  if (has(caps, 'board')) run(`set #${number} to In Progress`, () => tracker.setStatus(number, 'In Progress'))
  const lessons = lessonsForIssue(cwd, issue)
  // Who else is already changing what the issue talks about (its paths), before the first file is touched.
  const paths = pathsIn(`${issue.title}\n${issue.body ?? ''}`)
  let overlaps = []
  if (paths.length && tracker.openPullRequests) {
    try { overlaps = findOverlap({ tracker, git, cwd, config }, { files: paths, branch }).overlaps } catch { overlaps = [] }
  }
  return { started: !dryRun, dryRun, issue: { number, title: issue.title }, branch, base, worktree: worktree ? worktreePath : null, steps, lessons, overlaps, warnings: tracker.warnings ?? [] }
}

function mustGit(git, args) {
  const r = git(args)
  if (r.status !== 0) throw new CliError(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim().split('\n')[0]}`)
  return r.stdout
}
