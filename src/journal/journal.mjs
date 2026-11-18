// The journal: one Markdown file per entry under .agent-os/journal/YYYY/MM/, named
// <YYYY-MM-DDTHH-MM>-<author>-<slug>.md, with front matter (type, refs, areas, author). Unique names mean two branches
// never touch the same file, so merges never conflict. Lists are rendered on demand, never committed. Design §10.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { findDiacritics, toAscii } from '../i18n/i18n.mjs'
import { parse, scalar } from '../yaml/yaml.mjs'

export const JOURNAL_DIR = '.agent-os/journal'
export const TYPES = ['decision', 'lesson', 'incident', 'release', 'handoff', 'note']
const FILE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(.+)\.md$/
const REF = /^([#!&]\d+|\d{4}-\d{2}-\d{2}-[a-z0-9-]+)$/
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/
const AREA = /^[a-z0-9][a-z0-9-]*$/

/** A short ASCII kebab-case slug, at most `words` words. */
export function slugify(text, words = 6) {
  return toAscii(String(text)).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).slice(0, words).join('-') || 'entry'
}

/** "2026-11-18T14-02" for a date, in UTC so every laptop names the same moment the same way. */
export const stampOf = (date) => date.toISOString().slice(0, 16).replace(':', '-')

/** Splits a file into its front matter (parsed) and body. */
export function splitEntry(text, file = '<entry>') {
  const m = String(text).replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { meta: null, body: text, error: 'no front matter (a block between --- lines at the top)' }
  const bodyLine = m[0].slice(0, m[0].length - m[2].length).split('\n').length
  try { return { meta: parse(m[1], { file }) ?? {}, body: m[2], bodyLine } } catch (err) { return { meta: null, body: m[2], error: `front matter: ${err.message}` } }
}

/** The problems with one entry, as messages (empty when it is valid). */
export function validate({ name, folder, meta, body, error, bodyLine = 1 }, { lang = 'en' } = {}) {
  if (error) return [error]
  const problems = []
  const f = name.match(FILE)
  if (!f) problems.push('the file name is not <YYYY-MM-DDTHH-MM>-<author>-<slug>.md')
  else if (folder !== `${f[1]}/${f[2]}`) problems.push(`it is in ${folder || 'the journal root'}, its name says ${f[1]}/${f[2]}`)
  if (!TYPES.includes(meta.type)) problems.push(`type must be one of ${TYPES.join(', ')}${meta.type === undefined ? '' : ` (found "${meta.type}")`}`)
  if (!Array.isArray(meta.refs)) problems.push('refs must be a list, for example ["#12", "!40"] (it can be empty)')
  else for (const r of meta.refs) if (typeof r !== 'string' || !REF.test(r)) problems.push(`ref "${r}" is not #N, !N, &N or a decision id (YYYY-MM-DD-slug)`)
  if (!Array.isArray(meta.areas) || !meta.areas.length) problems.push('areas must be a list with at least one area')
  else for (const a of meta.areas) if (typeof a !== 'string' || !AREA.test(a)) problems.push(`area "${a}" must be lowercase kebab-case`)
  if (typeof meta.author !== 'string' || !LOGIN.test(meta.author)) problems.push('author must be a login')
  else if (f && !f[6].startsWith(`${meta.author}-`)) problems.push(`the file name must carry the author after the time: …T${f[4]}-${f[5]}-${meta.author}-<slug>.md`)
  if (!/^# \S/m.test(body)) problems.push('the body needs a "# Title" line')
  if (lang === 'ro') for (const d of findDiacritics(body).slice(0, 3)) problems.push(`line ${d.line + bodyLine - 1}: "${d.char}" (journal is ro, ASCII only: write "${d.ascii}")`)
  return problems
}

/** Every entry under the journal, oldest first (by time in the name, then by name). */
export function readJournal(cwd) {
  const root = join(cwd, JOURNAL_DIR)
  const entries = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, d.name)
      if (d.isDirectory()) walk(path)
      else if (d.name.endsWith('.md') && d.name !== 'README.md') {
        const text = readFileSync(path, 'utf8')
        const { meta, body, error, bodyLine } = splitEntry(text, path)
        const f = d.name.match(FILE)
        const folder = relative(root, dir).split(/[\\/]/).filter(Boolean).join('/')
        entries.push({
          id: d.name.slice(0, -3), name: d.name, folder, path: relative(cwd, path).split(/[\\/]/).join('/'),
          at: f ? `${f[1]}-${f[2]}-${f[3]}T${f[4]}:${f[5]}Z` : null,
          title: body.match(/^# (.+)$/m)?.[1].trim() ?? null, meta: meta ?? {}, body, bodyLine, error,
        })
      }
    }
  }
  walk(root)
  return entries.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '') || a.name.localeCompare(b.name))
}

/** Entries matching filters: type, area, ref, author, since and until (dates or times, inclusive). */
export function filterEntries(entries, { type, area, ref, author, since, until } = {}) {
  const day = (s, end) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T${end ? '23:59' : '00:00'}Z` : s)
  return entries.filter((e) => (!type || e.meta.type === type)
    && (!area || (e.meta.areas ?? []).includes(area))
    && (!ref || (e.meta.refs ?? []).includes(ref))
    && (!author || e.meta.author === author)
    && (!since || (e.at ?? '') >= day(since, false))
    && (!until || (e.at ?? '') <= day(until, true)))
}

/**
 * Writes a new entry and returns where. The name is unique: same author, minute and slug get -2, -3, ….
 * @param {string} cwd
 * @param {{ type: string, title: string, body?: string, refs?: string[], areas: string[], author: string, at?: Date, lang?: string, dryRun?: boolean }} entry
 */
export function addEntry(cwd, { type, title, body = '', refs = [], areas, author, at = new Date(), lang = 'en', dryRun = false }) {
  const stamp = stampOf(at)
  const folder = `${stamp.slice(0, 4)}/${stamp.slice(5, 7)}`
  const dir = join(cwd, JOURNAL_DIR, ...folder.split('/'))
  const base = `${stamp}-${author}-${slugify(title)}`
  let name = `${base}.md`
  for (let k = 2; existsSync(join(dir, name)); k++) name = `${base}-${k}.md`
  const content = [
    '---', `type: ${type}`, `refs: [${refs.map((r) => JSON.stringify(r)).join(', ')}]`, `areas: [${areas.map((a) => scalar(String(a))).join(', ')}]`, `author: ${author}`, '---', '',
    `# ${title.trim()}`, ...(body.trim() ? ['', body.trim()] : []), '',
  ].join('\n')
  const problems = validate({ name, folder, ...splitEntry(content) }, { lang })
  const path = `${JOURNAL_DIR}/${folder}/${name}`
  if (problems.length) return { written: false, path, problems }
  if (!dryRun) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, name), content) }
  return { written: !dryRun, dryRun, path, content }
}
