// The skill index: three tables (core, external, local) rendered on demand from the registry and the folders, never
// committed, so adding a skill needs no edit anywhere else. Plugin and builtin skills appear with the external ones,
// marked as living outside the repository. Descriptions come from each SKILL.md's front matter. Design §6.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OUTSIDE, readRegistry } from './registry.mjs'

const front = (text) => {
  const m = String(text ?? '').match(/^---\r?\n([\s\S]*?)\r?\n---/)
  return m ? Object.fromEntries(m[1].split(/\r?\n/).map((l) => l.match(/^([\w-]+):\s*(.*)$/)).filter(Boolean).map(([, k, v]) => [k, v.replace(/^["']|["']$/g, '').trim()])) : {}
}
const short = (d) => String(d ?? '').split(/(?<=\.)\s/)[0].slice(0, 140)

/** The skills, grouped as core, external (including plugin and builtin) and local. */
export function skillIndex(cwd) {
  const dir = join(cwd, '.claude', 'skills')
  const folders = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []
  const entries = new Map(readRegistry(cwd).filter((r) => r.entry?.name).map((r) => [r.entry.name, r.entry]))
  const rows = []
  for (const name of new Set([...folders, ...entries.keys()])) {
    const e = entries.get(name)
    const onDisk = folders.includes(name)
    if (!onDisk && !OUTSIDE.includes(e?.origin)) continue
    const file = join(dir, name, 'SKILL.md')
    const fm = onDisk && existsSync(file) ? front(readFileSync(file, 'utf8')) : {}
    const origin = e?.origin ?? 'local'
    rows.push({ name, origin, group: origin === 'core' ? 'core' : origin === 'local' ? 'local' : 'external', registered: Boolean(e), description: short(fm.description ?? e?.description), source: e?.source ?? null, version: e?.version ?? null, provides: e?.provides ?? [] })
  }
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return { core: rows.filter((r) => r.group === 'core'), external: rows.filter((r) => r.group === 'external'), local: rows.filter((r) => r.group === 'local') }
}

/** The index as three Markdown tables. */
export function indexMarkdown(index) {
  const table = (title, rows, extra) => [`## ${title}`, '', ...(rows.length ? [`| Skill | What it does${extra ? ' | Source' : ''} | Provides |`, `|---|---|${extra ? '---|' : ''}---|`, ...rows.map((r) => `| /${r.name}${r.registered ? '' : ' _(unregistered)_'} | ${r.description || '—'}${extra ? ` | ${OUTSIDE.includes(r.origin) ? `${r.origin}${r.source ? `: ${r.source}` : ''}` : `${r.source ?? '—'}${r.version ? ` (${r.version})` : ''}`}` : ''} | ${r.provides.join(', ') || '—'} |`)] : ['_None._']), '']
  return [...table('Core', index.core, false), ...table('External', index.external, true), ...table('Local', index.local, false)].join('\n').trimEnd()
}

/** One short line for the SessionStart context. */
export const indexLine = (index) => {
  const part = (label, rows) => (rows.length ? `${label} ${rows.map((r) => `/${r.name}`).join(' ')}` : null)
  const parts = [part('core', index.core), part('external', index.external), part('local', index.local)].filter(Boolean)
  return parts.length ? `Skills: ${parts.join('; ')} (agent-os skills for what each does).` : null
}
