// The optional per-laptop orchestrator (design §8, #35): one session coordinates the others on this laptop. The
// workers run in their own worktrees. It is off by default (`orchestrator` in .agent-os/local.json, set with
// `agent-os init --me --orchestrator`). Its ledger is personal JSON in .agent-os/cache/, never committed; across
// people, coordination stays on the platform. The orchestrator does not edit (a guard refuses it), and its typed
// messages carry no secrets and grant no permissions: a worker never gets past a refusal through it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { CliError } from '../cli/errors.mjs'

export const LEDGER = '.agent-os/cache/orchestrator.json'
export const TYPES = ['BRIEF', 'ACK', 'QUESTION', 'UPDATE', 'DONE', 'REVISE', 'CLOSE']
const STATES = { BRIEF: 'briefed', ACK: 'working', QUESTION: 'waiting', UPDATE: 'working', DONE: 'done', REVISE: 'working', CLOSE: 'closed' }
const EDIT_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$/

/** Secrets never travel in a message: token shapes and key=value secrets (the value is never echoed). */
const SECRET = /\b(gh[pousr]_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|npm_[A-Za-z0-9]{30,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S{6,}/i
/** A message may not ask a worker to get past a refusal: permissions are the person's, never the orchestrator's. */
const ESCALATION = /\b(bypass|skip|disable|turn off|work around) (the )?(guard|hook|check|permission|prompt|review)s?\b|--no-verify\b|--dangerously|\bdangerously-skip-permissions\b|\b(approve|grant|allow) (it|this|the (command|action|permission))\b.*\b(for|on behalf of) (me|you|the (user|person))\b|\bpermissions? (mode|settings)\b|settings(\.local)?\.json/i

const now = () => new Date().toISOString()
const empty = () => ({ version: 1, role: null, workers: [], messages: [] })

export function readLedger(cwd) {
  const f = join(cwd, LEDGER)
  if (!existsSync(f)) return empty()
  try { return { ...empty(), ...JSON.parse(readFileSync(f, 'utf8')) } } catch { throw new CliError(`${LEDGER} is not valid JSON`, { hint: 'it is personal and local: delete it and claim the role again' }) }
}

export function writeLedger(cwd, ledger) {
  const f = join(cwd, LEDGER)
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, `${JSON.stringify(ledger, null, 2)}\n`)
}

const enabled = (config) => {
  if (!config.orchestrator) throw new CliError('the orchestrator role is off on this laptop', { hint: 'turn it on in your personal settings: agent-os init --me --orchestrator' })
}

/** The session that runs in `cwd` becomes the orchestrator; one per checkout. */
export function claim(cwd, config, { force = false, at = now() } = {}) {
  enabled(config)
  const l = readLedger(cwd)
  const root = resolve(cwd)
  if (l.role && l.role.root !== root && !force) throw new CliError(`the orchestrator role is held by the session in ${l.role.root}`, { hint: 'release it there (agent-os orchestrate release), or --force when that session is gone' })
  l.role = { root, claimedAt: l.role?.root === root ? l.role.claimedAt : at }
  writeLedger(cwd, l)
  return l
}

export function release(cwd) {
  const l = readLedger(cwd)
  const had = Boolean(l.role)
  l.role = null
  writeLedger(cwd, l)
  return { released: had, ledger: l }
}

/** Refuses a message that carries a secret or asks a worker to get past a refusal. */
export function checkMessage(text) {
  if (SECRET.test(text)) throw new CliError('the message holds what looks like a secret: messages never carry one', { hint: 'name the variable or the secret store instead (for example "uses STRIPE_KEY from the environment")' })
  if (ESCALATION.test(text)) throw new CliError('the message asks to get past a guard, a check or a permission: the orchestrator cannot grant that', { hint: 'a refused action goes back to the person, who decides; say what was refused and why' })
}

/** The brief a worker starts from: the issue, the scope, and the rules it follows. */
export function briefText({ issue, title, worktree, notes }) {
  return [
    `BRIEF #${issue}: ${title ?? ''}`.trim(),
    `Worktree: ${worktree ?? '(agent-os start <n> --worktree)'}`,
    '',
    `1. Claim it first: agent-os start ${issue} --worktree, and work only in that worktree.`,
    '2. Do what the issue asks, with its test scenarios as tests; nothing outside its scope.',
    '3. Before the change request: npm test (or the gate), agent-os check title and agent-os check loop, exit codes checked.',
    '4. Report with ACK when you start, QUESTION when you are blocked, UPDATE at milestones, DONE with the change request.',
    '5. Permissions are the person\'s: a refused action is reported to the person, never retried through another session.',
    ...(notes ? ['', notes] : []),
  ].join('\n')
}

/** Adds a worker for an issue and records its BRIEF. Zero workers is a valid state. */
export function brief(cwd, config, { issue, title, worktree, notes, at = now() }) {
  enabled(config)
  if (!Number.isInteger(issue) || issue < 1) throw new CliError('brief needs an issue number')
  const text = briefText({ issue, title, worktree, notes })
  checkMessage(text)
  const l = readLedger(cwd)
  if (!l.role) throw new CliError('claim the orchestrator role first: agent-os orchestrate claim')
  const id = `w${issue}`
  const existing = l.workers.find((w) => w.id === id)
  if (existing && !['done', 'closed', 'gone'].includes(existing.state)) throw new CliError(`#${issue} already has a worker (${id}, ${existing.state})`)
  const worker = { id, issue, title: title ?? null, worktree: worktree ?? null, branch: null, state: 'briefed', pr: null, updatedAt: at }
  l.workers = [...l.workers.filter((w) => w.id !== id), worker]
  l.messages.push({ at, type: 'BRIEF', from: 'orchestrator', to: id, issue, text })
  writeLedger(cwd, l)
  return { worker, text }
}

/** Records a typed message between the orchestrator and a worker, and moves the worker's state. */
export function message(cwd, config, { type, worker, text = '', from, pr, at = now() }) {
  enabled(config)
  if (!TYPES.includes(type)) throw new CliError(`unknown message type "${type}"`, { hint: TYPES.join(', ') })
  if (type === 'BRIEF') throw new CliError('a BRIEF is sent with agent-os orchestrate brief <issue>')
  checkMessage(text)
  const l = readLedger(cwd)
  const w = l.workers.find((x) => x.id === worker || String(x.issue) === String(worker).replace(/^#/, ''))
  if (!w) throw new CliError(`no worker "${worker}"`, { hint: l.workers.length ? l.workers.map((x) => x.id).join(', ') : 'brief one first: agent-os orchestrate brief <issue>' })
  const sender = from ?? (['ACK', 'QUESTION', 'UPDATE', 'DONE'].includes(type) ? w.id : 'orchestrator')
  w.state = STATES[type]
  if (pr) w.pr = pr
  w.updatedAt = at
  l.messages.push({ at, type, from: sender, to: sender === 'orchestrator' ? w.id : 'orchestrator', issue: w.issue, text })
  writeLedger(cwd, l)
  return { worker: w }
}

/**
 * Brings the ledger in line with the repository: each worker's worktree (git worktree list) and its change request
 * (merged → done, closed → closed). Workers whose worktree is gone and that never reached a change request are gone.
 */
export function reconcile(cwd, { git, tracker }) {
  const l = readLedger(cwd)
  const wt = git(['worktree', 'list', '--porcelain'])
  const trees = wt.status === 0 ? String(wt.stdout).split(/\r?\n\r?\n/).map((b) => ({ path: b.match(/^worktree (.+)$/m)?.[1], branch: b.match(/^branch refs\/heads\/(.+)$/m)?.[1] })).filter((t) => t.path) : []
  const changes = []
  for (const w of l.workers.filter((x) => !['closed', 'gone'].includes(x.state))) {
    const tree = trees.find((t) => (w.worktree && resolve(t.path) === resolve(cwd, w.worktree)) || (t.branch && new RegExp(`^[\\w-]+/${w.issue}-`).test(t.branch)))
    if (tree) { if (!w.worktree) w.worktree = tree.path; if (tree.branch) w.branch = tree.branch }
    let pr = null
    if (w.branch) { try { pr = tracker.pullRequestFor(w.branch) } catch { pr = null } }
    const before = w.state
    if (pr?.merged || pr?.state === 'merged') w.state = 'done'
    else if (pr && pr.state === 'closed') w.state = 'closed'
    else if (!tree && !pr && w.state !== 'briefed' && w.state !== 'done') w.state = 'gone'
    if (pr?.number) w.pr = pr.number
    if (w.state !== before) changes.push({ id: w.id, from: before, to: w.state })
  }
  writeLedger(cwd, l)
  return { workers: l.workers, changes }
}

/**
 * The guard (PreToolUse): the session that holds the orchestrator role does not edit files. It briefs a worker
 * instead. Worker sessions run in their own worktrees, so they are never the orchestrator's checkout.
 */
export function orchestratorEditGuard(input, { cwd }) {
  if (!EDIT_TOOLS.test(input?.tool_name ?? '')) return null
  const sessionDir = resolve(input?.cwd ?? cwd)
  let l
  try { l = readLedger(sessionDir) } catch { return null }
  if (!l.role || resolve(l.role.root) !== sessionDir) return null
  return { decision: 'deny', message: 'agent-os guard "orchestrator-edit": this session is the orchestrator, and the orchestrator does not edit. Brief a worker (agent-os orchestrate brief <issue>), or release the role first (agent-os orchestrate release).' }
}
