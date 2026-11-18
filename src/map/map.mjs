// The on-demand map: one area of the code (headers, sizes, covering tests, recent changes), rendered when asked and
// trimmed to a token budget, never committed. File headers are cached by size and modification time in
// .agent-os/cache/, so a repeated map of one folder reads almost nothing. Design §10, research: file index.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const CACHE_FILE = '.agent-os/cache/map.json'
const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.agent-os', 'vendor', '.venv', 'target'])
const SOURCE = /\.(m?[jt]sx?|cjs|py|rb|go|rs|java|kt|cs|php|swift|ex|exs|vue|svelte|sql|sh|lua|c|cc|cpp|h|hpp|scala|css|scss|ya?ml|md|html)$/i
const TEST = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[^/]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py)$/i
const stem = (f) => f.split('/').pop().replace(/\.(test|spec)(?=\.)/, '').replace(/^test_/, '').replace(/_test(?=\.)/, '').replace(/\.[^.]+$/, '')

/** The 1–3 line header comment at the top of a file, for the common comment styles; null without one. */
export function headerOf(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/)
  let i = 0
  if (lines[0]?.startsWith('#!')) i++
  if (/^\{\{!/.test(lines[i] ?? '')) i++
  while (i < lines.length && lines[i].trim() === '') i++
  const first = lines[i] ?? ''
  const take = (re, strip) => { const out = []; for (; i < lines.length && re.test(lines[i]) && out.length < 3; i++) { const t = lines[i].replace(strip, '').trim(); if (t) out.push(t) } return out }
  let out = []
  if (/^\s*\/\//.test(first)) out = take(/^\s*\/\//, /^\s*\/\/+\s?/)
  else if (/^\s*#(?!!)/.test(first) && !/^#{1,6}\s/.test(first)) out = take(/^\s*#/, /^\s*#+\s?/)
  else if (/^\s*--/.test(first)) out = take(/^\s*--/, /^\s*--+\s?/)
  else if (/^\s*\/\*/.test(first)) { for (; i < lines.length && out.length < 3; i++) { const t = lines[i].replace(/^\s*\/?\*+\/?\s?/, '').replace(/\*\/\s*$/, '').trim(); if (t) out.push(t); if (/\*\//.test(lines[i])) break } }
  else if (/^\s*<!--/.test(first)) { for (; i < lines.length && out.length < 3; i++) { const t = lines[i].replace(/<!--|-->/g, '').trim(); if (t) out.push(t); if (/-->/.test(lines[i])) break } }
  else if (/^\s*("""|''')/.test(first)) {
    const q = first.trim().slice(0, 3)
    for (let k = i; k < lines.length && out.length < 3; k++) {
      const t = lines[k].replaceAll(q, '').trim()
      if (t) out.push(t)
      const closes = k === i ? lines[k].trim().length > 3 && lines[k].trim().endsWith(q) : lines[k].includes(q)
      if (closes) break
    }
  }
  else if (/^#\s/.test(first)) out = [first.replace(/^#\s+/, '')]
  return out.length ? out.join(' ') : null
}

/** Files under a folder, relative with "/", skipping dependencies, builds and caches. */
export function filesUnder(cwd, path = '.') {
  const out = []
  const walk = (rel) => {
    let entries
    try { entries = readdirSync(join(cwd, rel), { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue
      const r = rel === '.' ? e.name : `${rel}/${e.name}`
      if (e.isDirectory()) walk(r)
      else if (e.isFile()) out.push(r)
    }
  }
  walk(path.replace(/\/+$/, '') || '.')
  return out.sort()
}

const readCache = (cwd) => { try { return JSON.parse(readFileSync(join(cwd, CACHE_FILE), 'utf8')) } catch { return { files: {} } } }

/**
 * The map of one area.
 * @param {{ cwd: string, git?: Function }} deps
 * @param {{ path?: string, budget?: number }} options budget in tokens (about 4 characters each)
 */
export function mapArea({ cwd, git }, { path = '.', budget = 1500 } = {}) {
  const cache = readCache(cwd)
  let dirty = false
  const all = filesUnder(cwd, path)
  const tests = all.filter((f) => TEST.test(f))
  const testsByStem = new Map()
  for (const t of tests) testsByStem.set(stem(t), [...(testsByStem.get(stem(t)) ?? []), t])
  const recent = new Map()
  if (git) {
    const r = git(['log', '--since=30.days', '--name-only', '--format=', '--', path])
    if (r.status === 0) for (const f of r.stdout.split(/\r?\n/).filter(Boolean)) recent.set(f, (recent.get(f) ?? 0) + 1)
  }
  const entries = []
  for (const f of all.filter((x) => SOURCE.test(x) && !TEST.test(x))) {
    let st
    try { st = statSync(join(cwd, f)) } catch { continue }
    let c = cache.files[f]
    if (!c || c.size !== st.size || c.mtimeMs !== st.mtimeMs) {
      const text = st.size > 512 * 1024 ? '' : readFileSync(join(cwd, f), 'utf8')
      c = { size: st.size, mtimeMs: st.mtimeMs, lines: text ? text.split('\n').length : null, header: text ? headerOf(text) : null }
      cache.files[f] = c
      dirty = true
    }
    entries.push({ file: f, lines: c.lines, header: c.header, tests: testsByStem.get(stem(f)) ?? [], changes: recent.get(f) ?? 0 })
  }
  if (dirty) { try { mkdirSync(join(cwd, '.agent-os', 'cache'), { recursive: true }); writeFileSync(join(cwd, CACHE_FILE), JSON.stringify(cache)) } catch { /* the cache is an optimisation */ } }
  // Recently changed files first: they are where work is happening.
  entries.sort((a, b) => b.changes - a.changes || a.file.localeCompare(b.file))
  return { path, files: entries.length, tests: tests.length, entries, ...renderBudget(entries, { budget, path }) }
}

/** The entries as text within the budget; what does not fit is counted, not dropped silently. */
function renderBudget(entries, { budget, path }) {
  const limit = budget * 4
  const lines = []
  let used = 0
  let shown = 0
  for (const e of entries) {
    const line = `${e.file}${e.lines ? ` (${e.lines} lines)` : ''}${e.header ? `: ${e.header}` : ''}${e.tests.length ? ` [tests: ${e.tests.join(', ')}]` : ''}${e.changes ? ` [${e.changes} change(s) in 30 days]` : ''}`
    if (used + line.length + 1 > limit) break
    lines.push(line)
    used += line.length + 1
    shown++
  }
  const more = entries.length - shown
  return { text: [`# Map of ${path === '.' ? 'the repository' : path}`, ...lines, ...(more ? [`… and ${more} more file(s): narrow the path or raise --budget`] : [])].join('\n'), shown, more }
}
