// Decision records: docs/decisions/<YYYY-MM-DD>-<slug>.md, a date plus a slug and never a running number, so two
// branches adding decisions never claim the same id. An accepted record is not rewritten: a change is a new record
// that supersedes it, and the old one only gets its status line pointed at the successor.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { slugify } from '../journal/journal.mjs'

export const DECISIONS_DIR = 'docs/decisions'
const NAME = /^(\d{4}-\d{2}-\d{2})-([a-z0-9][a-z0-9-]*)\.md$/

const WORDS = {
  en: { status: 'Status', context: 'Context', decision: 'Decision', consequences: 'Consequences', proposed: 'proposed', accepted: 'accepted', rejected: 'rejected', superseded: 'superseded by', supersedes: 'supersedes' },
  ro: { status: 'Stare', context: 'Context', decision: 'Decizie', consequences: 'Consecinte', proposed: 'propusa', accepted: 'acceptata', rejected: 'respinsa', superseded: 'inlocuita de', supersedes: 'inlocuieste' },
}

/** Every record, oldest first, with its title, status and links. */
export function readDecisions(cwd) {
  const dir = join(cwd, DECISIONS_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort().map((name) => {
    const text = readFileSync(join(dir, name), 'utf8')
    const status = text.match(/^(Status|Stare):\s*(.+)$/m)
    return { id: name.slice(0, -3), name, path: `${DECISIONS_DIR}/${name}`, valid: NAME.test(name), title: text.match(/^# (.+)$/m)?.[1] ?? null, statusLine: status?.[2]?.trim() ?? null, text }
  })
}

/** The state of a record from its status line, in either language. */
export function stateOf(statusLine) {
  const s = String(statusLine ?? '').toLowerCase()
  for (const lang of Object.values(WORDS)) {
    if (s.startsWith(lang.superseded)) return 'superseded'
    for (const k of ['proposed', 'accepted', 'rejected']) if (s.startsWith(lang[k])) return k
  }
  return null
}

const links = (line) => [...String(line ?? '').matchAll(/\]\(([^)\s]+\.md)\)/g)].map((m) => m[1].replace(/^\.\//, ''))

/** The problems with every record: name, title, status, sections, and superseded records linking their successor. */
export function checkDecisions(cwd) {
  const all = readDecisions(cwd)
  const ids = new Set(all.map((d) => d.name))
  const problems = []
  for (const d of all) {
    const p = (message, fix) => problems.push({ path: d.path, message, fix })
    if (!d.valid) p(`${d.name} is not named <YYYY-MM-DD>-<slug>.md`, `rename it, for example ${new Date().toISOString().slice(0, 10)}-${slugify(d.title ?? d.name, 5)}.md`)
    if (!d.title) p('it has no "# Title" line', 'add the decision in a few words as the first heading')
    const state = stateOf(d.statusLine)
    if (!state) p('its status line is missing or unknown', 'start it with "Status: proposed | accepted | rejected | superseded by [<record>](<file>)"')
    const sections = Object.values(WORDS).find((w) => ['context', 'decision', 'consequences'].every((k) => new RegExp(`^## ${w[k]}\\s*$`, 'm').test(d.text)))
    if (!sections) p('it lacks a Context, Decision or Consequences section', 'add the three sections (Context, Decizie… in ro)')
    if (state === 'superseded') {
      const successor = links(d.statusLine)[0]
      if (!successor) p('it is superseded but its status does not link its successor', 'write "Status: superseded by [<title>](<YYYY-MM-DD>-<slug>.md)"')
      else if (!ids.has(successor)) p(`it is superseded by ${successor}, which does not exist`, 'point the status at the record that replaces it')
    }
  }
  return { records: all.length, problems }
}

/** The body of a new record, in the docs language. */
export function template({ title, lang = 'en', supersedes = null }) {
  const w = WORDS[lang] ?? WORDS.en
  const ro = lang === 'ro'
  return `# ${title}

${w.status}: ${w.proposed}${supersedes ? ` · ${w.supersedes} [${supersedes.title ?? supersedes.id}](${supersedes.name})` : ''}

## ${w.context}
${ro ? 'Ce problema rezolva decizia si ce constrangeri exista. Faptele, cu legaturi catre issue-uri, PR-uri si cercetare.' : 'What problem this decides and under which constraints. The facts, with links to issues, PRs and research.'}

## ${w.decision}
${ro ? 'Ce s-a decis, in propozitii scurte. Variantele respinse, si de ce.' : 'What was decided, in short sentences. The options that were rejected, and why.'}

## ${w.consequences}
${ro ? 'Ce devine mai usor, ce devine mai greu, ce trebuie urmarit.' : 'What becomes easier, what becomes harder, what to watch.'}
`
}

/**
 * Creates a record. Same day and same slug is refused (pick another slug); different slugs never collide. With
 * `supersedes`, the old record's status line is pointed at the new one and nothing else in it changes.
 */
export function newDecision(cwd, { slug, title, lang = 'en', supersedes, accepted = false, now = new Date(), dryRun = false }) {
  const s = slugify(slug ?? title ?? '', 6)
  if (!title) throw new CliError('--title is required: the decision in a few words')
  const name = `${now.toISOString().slice(0, 10)}-${s}.md`
  const path = `${DECISIONS_DIR}/${name}`
  if (existsSync(join(cwd, path))) throw new CliError(`${path} already exists`, { hint: 'pick another slug; a change to an accepted decision is a new record with --supersedes' })
  let old = null
  if (supersedes) {
    old = readDecisions(cwd).find((d) => d.id === supersedes || d.name === supersedes || d.id.endsWith(supersedes))
    if (!old) throw new CliError(`no decision record "${supersedes}"`, { hint: 'agent-os decision list' })
    if (stateOf(old.statusLine) === 'superseded') throw new CliError(`${old.path} is already superseded`, { hint: `supersede its successor instead: ${links(old.statusLine)[0]}` })
  }
  let content = template({ title, lang, supersedes: old })
  const w = WORDS[lang] ?? WORDS.en
  if (accepted) content = content.replace(`${w.status}: ${w.proposed}`, `${w.status}: ${w.accepted}`)
  const steps = [`create ${path}`, ...(old ? [`mark ${old.path} as superseded by ${name}`] : [])]
  if (dryRun) return { dryRun: true, path, steps, content }
  mkdirSync(join(cwd, DECISIONS_DIR), { recursive: true })
  writeFileSync(join(cwd, path), content)
  if (old) {
    const ow = /^Stare:/m.test(old.text) ? WORDS.ro : WORDS.en
    writeFileSync(join(cwd, old.path), old.text.replace(/^(Status|Stare):\s*.+$/m, `${ow.status}: ${ow.superseded} [${title}](${name})`))
  }
  return { path, steps }
}
