// Overlap: open change requests and pushed branches that touch the same files as yours, found before merge time.
// The files of a change request are cached by its head commit (immutable), so a repeated run asks the platform for
// one list and nothing else. Design §5 (Seeing overlap).

import { areasFor } from '../stack/areas.mjs'
import { componentGraph, ownerOf } from '../system/affected.mjs'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { issueRefs } from '../conventions/conventions.mjs'

export const CACHE_FILE = '.agent-os/cache/overlap.json'

const readCache = (cwd) => { try { return JSON.parse(readFileSync(join(cwd, CACHE_FILE), 'utf8')) } catch { return { files: {} } } }
const writeCache = (cwd, cache) => { mkdirSync(join(cwd, '.agent-os', 'cache'), { recursive: true }); writeFileSync(join(cwd, CACHE_FILE), `${JSON.stringify(cache)}\n`) }

/** True when two paths are the same file, or one is a folder ("src/db/") containing the other. */
export function touches(a, b) {
  if (a === b) return true
  const dir = (p) => (p.endsWith('/') ? p : null)
  return Boolean((dir(a) && b.startsWith(a)) || (dir(b) && a.startsWith(b)))
}

const lines = (r) => (r.status === 0 ? r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [])
const numberIn = (branch) => Number(String(branch).match(/(?:^|\/)(\d+)-/)?.[1]) || null

/**
 * Who else is changing these files.
 * @param {{ tracker?: object, git: Function, cwd: string, config: object }} deps
 * @param {{ files: string[], branch?: string, now?: number, ttlMs?: number }} input
 */
export function findOverlap({ tracker, git, cwd, config }, { files, branch, ttlMs = 10 * 60e3, now = Date.now() }) {
  const mine = [...new Set(files)]
  const base = config.branches.integration
  const longLived = new Set([base, config.branches.production, 'HEAD'])
  const cache = readCache(cwd)
  const warnings = []
  const found = []
  let prs = []
  if (tracker) {
    try {
      prs = cache.list && now - cache.list.at < ttlMs ? cache.list.prs : tracker.openPullRequests()
      if (!(cache.list && now - cache.list.at < ttlMs)) cache.list = { at: now, prs }
    } catch (err) { warnings.push(`open change requests could not be listed: ${err.message.split('\n')[0]}`) }
  }
  const seen = new Set(cache.files ? Object.keys(cache.files) : [])
  for (const pr of prs) {
    if (pr.branch === branch) continue
    const key = `${pr.number}@${pr.head}`
    if (!cache.files[key]) {
      try { cache.files[key] = tracker.pullRequestFiles(pr.number) } catch (err) { warnings.push(`files of #${pr.number}: ${err.message.split('\n')[0]}`); continue }
    }
    seen.delete(key)
    const shared = cache.files[key].filter((f) => mine.some((m) => touches(m, f)))
    if (shared.length) {
      const refs = issueRefs(pr.body ?? '')
      found.push({ kind: 'change-request', number: pr.number, title: pr.title, author: pr.author, branch: pr.branch, issues: [...refs.closes, ...refs.refs], url: pr.url, files: shared })
    }
  }
  for (const stale of seen) delete cache.files[stale]
  // Pushed branches without an open change request: compared locally, against the base.
  const withCr = new Set(prs.map((p) => p.branch))
  for (const ref of lines(git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']))) {
    const name = ref.replace(/^origin\//, '')
    if (ref === 'origin' || longLived.has(name) || name === branch || withCr.has(name)) continue
    const theirs = lines(git(['diff', '--name-only', `origin/${base}...${ref}`]))
    const shared = theirs.filter((f) => mine.some((m) => touches(m, f)))
    if (!shared.length) continue
    const author = lines(git(['log', '-1', '--format=%an', ref]))[0] ?? null
    found.push({ kind: 'branch', branch: name, author, issues: numberIn(name) ? [numberIn(name)] : [], files: shared })
  }
  try { writeCache(cwd, cache) } catch { /* the cache is an optimisation */ }
  found.sort((a, b) => b.files.length - a.files.length || String(a.number ?? a.branch).localeCompare(String(b.number ?? b.branch), 'en', { numeric: true }))
  // The stack areas the shared files belong to, so "same area" reads before the file list.
  let graph = null
  try { graph = componentGraph(cwd) } catch { graph = null }
  for (const o of found) {
    const areas = areasFor(o.files, cwd)
    if (areas.length) o.areas = areas
    // Components are finer than layers in a monorepo: name the ones both changes touch.
    if (graph && Object.keys(graph.components).length > 1) { const comps = [...new Set(o.files.map((f) => ownerOf(f, graph.components)).filter(Boolean))].sort(); if (comps.length) o.components = comps }
  }
  return { files: mine, overlaps: found, warnings }
}

/** One line per overlap, for command output and skills. */
export const overlapLines = (overlaps, vocab) => overlaps.map((o) => `  ${o.kind === 'branch' ? `branch ${o.branch}` : `${vocab.crRef}${o.number} ${o.title}`}${o.author ? ` by @${o.author}` : ''}${o.issues.length ? ` (${o.issues.map((n) => `#${n}`).join(', ')})` : ''}${o.areas?.length ? ` [${o.areas.join(', ')}]` : ''}${o.components?.length ? ` {${o.components.join(', ')}}` : ''}: ${o.files.slice(0, 5).join(', ')}${o.files.length > 5 ? `, +${o.files.length - 5}` : ''}`)
