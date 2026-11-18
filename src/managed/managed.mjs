// Managed files: what agent-os installs into a project, how it updates it without destroying local edits, and how a
// project takes a file back. Decision: docs/decisions/2026-11-18-managed-files-and-lock.md.
//
// Three kinds of managed item, each identified by a lock key:
//   file    `path`            the whole file
//   block   `path#<id>`       a region in a Markdown file between <!-- agent-os:begin <id> --> and <!-- agent-os:end <id> -->
//   hooks   `path#hooks`      the hook entries in a Claude Code settings.json whose command runs `agent-os hook`
// For each item, `.agent-os/base/<key>` keeps the content agent-os last installed (the merge base), and
// `.agent-os/lock.json` records its version and sha256. Local content equal to the base is "unmodified".

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { merge3 } from './merge3.mjs'
import { CliError, EXIT } from '../cli/errors.mjs'

export const LOCK_FILE = '.agent-os/lock.json'
export const BASE_DIR = '.agent-os/base'
const LOCK_VERSION = 1

/** sha256 of text with line endings normalized, so a CRLF checkout does not look like a local edit. */
export const hash = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex')
const eq = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n')

// ── Lock and base ──────────────────────────────────────────────────────────

export function readLock(cwd) {
  const path = join(cwd, LOCK_FILE)
  if (!existsSync(path)) return { lockVersion: LOCK_VERSION, platform: null, migrations: [], items: {}, vendored: {} }
  try {
    const lock = JSON.parse(readFileSync(path, 'utf8'))
    return { lockVersion: lock.lockVersion ?? LOCK_VERSION, platform: lock.platform ?? null, migrations: lock.migrations ?? [], items: lock.items ?? {}, vendored: lock.vendored ?? {} }
  } catch {
    throw new CliError(`${LOCK_FILE} is not valid JSON`, { hint: 'run "agent-os update --relock" to rebuild it from .agent-os/base/' })
  }
}

export function writeLock(cwd, lock) {
  const items = Object.fromEntries(Object.entries(lock.items).sort(([a], [b]) => a.localeCompare(b)))
  mkdirSync(join(cwd, '.agent-os'), { recursive: true })
  const vendored = Object.fromEntries(Object.entries(lock.vendored ?? {}).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(join(cwd, LOCK_FILE), `${JSON.stringify({ lockVersion: LOCK_VERSION, ...(lock.platform ? { platform: lock.platform } : {}), ...(lock.migrations?.length ? { migrations: lock.migrations } : {}), items, ...(Object.keys(vendored).length ? { vendored } : {}) }, null, 2)}\n`)
}

const baseFile = (cwd, key) => join(cwd, BASE_DIR, key.replace('#', '.__'))
const keyFromBase = (rel) => rel.replace(/\.__([\w-]+)$/, '#$1')
const readBase = (cwd, key) => (existsSync(baseFile(cwd, key)) ? readFileSync(baseFile(cwd, key), 'utf8') : null)
function writeBase(cwd, key, content) {
  mkdirSync(dirname(baseFile(cwd, key)), { recursive: true })
  writeFileSync(baseFile(cwd, key), content)
}

// ── Markdown blocks ────────────────────────────────────────────────────────

const begin = (id) => `<!-- agent-os:begin ${id} -->`
const end = (id) => `<!-- agent-os:end ${id} -->`

/** The text between a block's markers (without them), or null when the block is not there. */
export function readBlock(text, id) {
  const a = text.indexOf(begin(id))
  const b = text.indexOf(end(id))
  if (a < 0 || b < a) return null
  return text.slice(a + begin(id).length, b).replace(/^\r?\n/, '').replace(/\r?\n$/, '')
}

/** Replaces a block's content, or appends the block when it is missing. Everything outside it is kept byte for byte. */
export function writeBlock(text, id, content) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  const body = `${begin(id)}${nl}${content.replace(/\r?\n/g, nl)}${nl}${end(id)}`
  const a = text.indexOf(begin(id))
  const b = text.indexOf(end(id))
  if (a >= 0 && b > a) return text.slice(0, a) + body + text.slice(b + end(id).length)
  if (text === '') return `${body}${nl}`
  return `${text}${text.endsWith('\n') ? '' : nl}${nl}${body}${nl}`
}

// ── settings.json hooks ────────────────────────────────────────────────────

/** Events in a fixed order, so the managed hooks hash the same whatever order a settings file lists them in. */
const EVENT_ORDER = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SubagentStop', 'PreCompact', 'SessionEnd']
const isManagedHook = (h) => typeof h?.command === 'string' && /\bagent-os(@\S+)?\s+hook\b/.test(h.command)

/** The managed hook entries of a settings object, as a canonical JSON string (for hashing and merging): events in a fixed order. */
export function readHooks(settings) {
  const out = {}
  const order = (e) => { const i = EVENT_ORDER.indexOf(e); return i < 0 ? EVENT_ORDER.length : i }
  const events = Object.keys(settings.hooks ?? {}).sort((a, b) => order(a) - order(b) || a.localeCompare(b))
  for (const event of events) {
    const managed = (settings.hooks[event] ?? []).map((g) => ({ ...g, hooks: (g.hooks ?? []).filter(isManagedHook) })).filter((g) => g.hooks.length)
    if (managed.length) out[event] = managed
  }
  return `${JSON.stringify(out, null, 2)}\n`
}

/** The content of a hooks item for a `{ Event: [groups] }` object (see settingsHooks in src/hooks/runner.mjs). */
export const hooksContent = (hooks) => readHooks({ hooks })

/** Replaces the managed hook entries and keeps every other hook and setting. */
export function writeHooks(settings, managedJson) {
  const managed = JSON.parse(managedJson)
  const hooks = {}
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    const kept = (groups ?? []).map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isManagedHook(h)) })).filter((g) => g.hooks.length)
    if (kept.length) hooks[event] = kept
  }
  for (const [event, groups] of Object.entries(managed)) hooks[event] = [...(hooks[event] ?? []), ...groups]
  return { ...settings, hooks }
}

// ── Reading and writing one item ───────────────────────────────────────────

const kindOf = (key) => (key.endsWith('#hooks') ? 'hooks' : key.includes('#') ? 'block' : 'file')
const pathOf = (key) => key.split('#')[0]

/** The item's current content in the project, or null when it is absent. */
function readItem(cwd, key) {
  const file = join(cwd, pathOf(key))
  if (!existsSync(file)) return null
  const text = readFileSync(file, 'utf8')
  if (kindOf(key) === 'file') return text
  if (kindOf(key) === 'block') return readBlock(text, key.split('#')[1])
  let hooks
  try { hooks = readHooks(JSON.parse(text)) } catch { throw new CliError(`${pathOf(key)} is not valid JSON`, { hint: 'fix it before updating its hooks' }) }
  return hooks === '{}\n' ? null : hooks
}

/** Writes the item's new content into the project, touching nothing outside it. */
function writeItem(cwd, key, content) {
  const file = join(cwd, pathOf(key))
  mkdirSync(dirname(file), { recursive: true })
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (kindOf(key) === 'file') writeFileSync(file, content)
  else if (kindOf(key) === 'block') writeFileSync(file, writeBlock(existing, key.split('#')[1], content))
  else writeFileSync(file, `${JSON.stringify(writeHooks(existing ? JSON.parse(existing) : {}, content), null, 2)}\n`)
}

// ── Apply (install and update) ─────────────────────────────────────────────

/**
 * @typedef {object} Item
 * @property {string} key `path`, `path#<block-id>` or `path#hooks`
 * @property {string} content what agent-os wants installed now
 */

/**
 * Installs or updates managed items. Unmodified items are replaced; locally edited ones are merged three ways;
 * conflicts leave the local content untouched and write `<path>.rej` with the merge and its markers.
 * @param {string} cwd
 * @param {Item[]} items
 * @param {{ version: string, dryRun?: boolean }} options
 * @returns {{ key: string, action: 'installed' | 'adopted' | 'replaced' | 'merged' | 'unchanged' | 'conflict' | 'locally-deleted', rej?: string }[]}
 */
export function applyManaged(cwd, items, { version, dryRun = false }) {
  const lock = readLock(cwd)
  const results = []
  for (const { key, content } of items) {
    const local = readItem(cwd, key)
    const entry = lock.items[key]
    const base = entry ? readBase(cwd, key) : null
    const record = () => {
      if (dryRun) return
      writeBase(cwd, key, content)
      lock.items[key] = { kind: kindOf(key), version, sha256: hash(content) }
    }
    let action
    let rej
    if (!entry) {
      if (local === null) { action = 'installed'; if (!dryRun) writeItem(cwd, key, content); record() }
      else if (eq(local, content)) { action = 'adopted'; record() }
      else { action = 'conflict'; rej = conflict(cwd, key, '', local, content, version, dryRun, 'exists and is not managed by agent-os yet') }
    } else if (local === null) {
      action = 'locally-deleted'
    } else if (hash(local) === entry.sha256) {
      action = eq(local, content) ? 'unchanged' : 'replaced'
      if (action === 'replaced' && !dryRun) writeItem(cwd, key, content)
      record()
    } else if (base === null) {
      action = 'conflict'
      rej = conflict(cwd, key, '', local, content, version, dryRun, `it was edited locally and its merge base (${BASE_DIR}) is missing`)
    } else {
      const m = merge3(base, local, content, { oursLabel: 'local', theirsLabel: `agent-os ${version}` })
      if (m.conflicts) { action = 'conflict'; rej = conflict(cwd, key, base, local, content, version, dryRun, `${m.conflicts} conflicting change(s)`, m.text) }
      else {
        action = eq(m.text, local) ? 'unchanged' : 'merged'
        if (action === 'merged' && !dryRun) writeItem(cwd, key, m.text)
        record()
      }
    }
    results.push({ key, action, ...(rej ? { rej } : {}) })
  }
  if (!dryRun) writeLock(cwd, lock)
  return results
}

/** The exit code for a set of apply results: 1 (a check failed) when any item ended in a conflict, otherwise 0. */
export const exitCodeFor = (results) => (results.some((r) => r.action === 'conflict') ? EXIT.CHECK_FAILED : EXIT.OK)

/** Writes `<path>.rej` with the proposal; the local content and the base stay as they are, so the next update retries. */
function conflict(cwd, key, base, local, content, version, dryRun, reason, merged) {
  const rej = `${pathOf(key)}${kindOf(key) === 'file' ? '' : `.${key.split('#')[1]}`}.rej`
  const proposal = merged ?? merge3(base, local, content, { oursLabel: 'local', theirsLabel: `agent-os ${version}` }).text
  if (!dryRun) {
    writeFileSync(join(cwd, rej), [
      `agent-os ${version} could not update ${key}: ${reason}.`,
      'Your version is untouched. Below is the proposed result with conflict markers:',
      'resolve them in your file, then run "agent-os update" again (or "agent-os eject" to keep your version for good).',
      '',
      proposal,
    ].join('\n'))
  }
  return rej
}

// ── Eject and relock ───────────────────────────────────────────────────────

/** Stops managing every item of a path (or one item by key). The project's content is left exactly as it is. */
export function eject(cwd, target, { dryRun = false } = {}) {
  const lock = readLock(cwd)
  const keys = Object.keys(lock.items).filter((k) => k === target || pathOf(k) === target)
  if (!keys.length) throw new CliError(`${target} is not managed by agent-os`, { hint: `see ${LOCK_FILE} for the managed paths` })
  if (!dryRun) {
    for (const k of keys) { delete lock.items[k]; rmSync(baseFile(cwd, k), { force: true }) }
    writeLock(cwd, lock)
  }
  return keys
}

/** Rebuilds the lock from .agent-os/base/ (for example after a merge conflict in lock.json), keeping known versions. */
export function relock(cwd, { version }) {
  let oldPlatform = null
  let oldMigrations = []
  let oldVendored = {}
  const old = (() => { try { const l = readLock(cwd); oldPlatform = l.platform; oldMigrations = l.migrations; oldVendored = l.vendored; return l.items } catch { return {} } })()
  const dir = join(cwd, BASE_DIR)
  const items = {}
  const walk = (d) => {
    for (const name of existsSync(d) ? readdirSync(d) : []) {
      const full = join(d, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      const key = keyFromBase(relative(dir, full).split(sep).join('/'))
      items[key] = { kind: kindOf(key), version: old[key]?.version ?? version, sha256: hash(readFileSync(full, 'utf8')) }
    }
  }
  walk(dir)
  writeLock(cwd, { platform: oldPlatform, migrations: oldMigrations, items, vendored: oldVendored })
  return Object.keys(items).sort()
}
