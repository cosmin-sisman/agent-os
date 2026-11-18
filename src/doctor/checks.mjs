// doctor's checks: each one looks at one thing, returns findings that say what is wrong and what fixes it, and may
// offer a mechanical fix. Local checks read only the working tree; platform checks ask the tracker and are skipped
// with --offline and --ci. Design §10 (Verify) and §6 (Consistency).

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { COMMANDS } from '../cli/registry.mjs'
import { GITIGNORE_ENTRIES } from '../config/config.mjs'
import { checkTitle } from '../conventions/conventions.mjs'
import { findDiacritics, languageFor, labelSet, toAscii } from '../i18n/i18n.mjs'
import { readJournal, validate as validateEntry } from '../journal/journal.mjs'
import { readLessons, validateCard } from '../lessons/lessons.mjs'
import { checkDecisions } from '../decisions/decisions.mjs'
import { readLock } from '../managed/managed.mjs'
import { OUTSIDE, readRegistry } from '../registry/registry.mjs'
import { matches } from '../util/glob.mjs'
import { legacyFeatures, lifecycleOf, noticeFor } from '../lifecycle/legacy.mjs'
import { readExceptions, deprecatedInUse } from '../lifecycle/manifest.mjs'
import { TEMPLATES } from '../managed/install.mjs'
import { versionStatus } from '../version/pin.mjs'
import { labelId } from '../workflow/next.mjs'

/**
 * @typedef {{ level: 'ok' | 'warn' | 'fail', message: string, fix?: string, path?: string, apply?: () => string }} Finding
 * `apply` is a mechanical repair that `doctor --fix` may run; it returns what it did.
 */

const SKILLS = '.claude/skills'
const REGISTRY = '.agent-os/registry'
const read = (cwd, p) => { try { return readFileSync(join(cwd, p), 'utf8') } catch { return null } }
const dirs = (cwd, p) => { try { return readdirSync(join(cwd, p), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() } catch { return [] } }
const ok = (message) => ({ level: 'ok', message })

/** Files under a folder (relative, "/"), skipping node_modules, .git and the cache. */
export function walk(cwd, dir = '.', { skip = ['node_modules', '.git', '.agent-os/cache', '.agent-os/base'] } = {}) {
  const out = []
  const go = (d) => {
    let entries
    try { entries = readdirSync(join(cwd, d), { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const rel = d === '.' ? e.name : `${d}/${e.name}`
      if (skip.includes(rel) || skip.includes(e.name)) continue
      if (e.isDirectory()) go(rel)
      else out.push(rel)
    }
  }
  go(dir)
  return out.sort()
}

/** The YAML-ish front matter of a SKILL.md: only the simple `key: value` lines doctor needs. */
export function frontMatter(text) {
  const m = String(text ?? '').match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return null
  return Object.fromEntries(m[1].split(/\r?\n/).map((l) => l.match(/^([\w-]+):\s*(.*)$/)).filter(Boolean).map(([, k, v]) => [k, v.replace(/^["']|["']$/g, '').trim()]))
}

// ── Local checks ───────────────────────────────────────────────────────────

/** Every skill folder has a valid registry entry, every entry (but plugin and builtin) a folder, every SKILL.md its front matter. */
function skills({ cwd }) {
  const out = []
  const managed = new Set(Object.keys(readLock(cwd).items).map((k) => k.match(/^\.claude\/skills\/([^/]+)\//)?.[1]).filter(Boolean))
  const registry = new Map()
  for (const r of readRegistry(cwd)) {
    if (r.problems.length) out.push({ level: 'fail', path: r.path, message: `${r.path}: ${r.problems.join('; ')}`, fix: 'fix the entry (design §6), or agent-os skill register <name> --origin … --force' })
    if (r.entry?.name) registry.set(r.entry.name, { ...r.entry, file: r.path })
  }
  const folders = dirs(cwd, SKILLS)
  for (const name of folders) {
    const path = `${SKILLS}/${name}/SKILL.md`
    const text = read(cwd, path)
    if (!registry.has(name)) {
      if (managed.has(name)) out.push({ level: 'warn', path: `${SKILLS}/${name}`, message: `${SKILLS}/${name} is managed by agent-os but has no registry entry`, fix: 'agent-os update (it writes the core entries)' })
      else out.push({ level: 'fail', path: `${SKILLS}/${name}`, message: `the skill folder ${SKILLS}/${name} has no registry entry`, fix: `agent-os skill register ${name} --origin local (or external with --source), or remove the folder` })
    }
    if (text === null) { out.push({ level: 'fail', path: `${SKILLS}/${name}`, message: `${SKILLS}/${name} has no SKILL.md`, fix: `add ${path} or remove the folder` }); continue }
    const fm = frontMatter(text)
    if (!fm?.name || !fm?.description) out.push({ level: 'fail', path, message: `${path} needs front matter with name and description`, fix: 'add a --- block with name: and description: at the top' })
    else if (fm.name !== name) out.push({ level: 'warn', path, message: `${path} is named "${fm.name}" but lives in ${name}/`, fix: `rename the folder or set name: ${name}` })
  }
  for (const [name, e] of registry) {
    if (OUTSIDE.includes(e.origin)) continue
    if (!folders.includes(name)) out.push({ level: 'fail', path: e.file, message: `${e.file} registers "${name}", which has no folder in ${SKILLS}/`, fix: `restore ${SKILLS}/${name}/ or delete ${e.file}` })
  }
  return out.length ? out : [ok(`${folders.length} skill(s), all registered`)]
}

/** Slots point at skills that exist (on disk or registered as plugin/builtin). */
function slots({ cwd, config }) {
  const known = new Set([...dirs(cwd, SKILLS), ...walk(cwd, REGISTRY).filter((p) => p.endsWith('.json')).map((p) => p.split('/').pop().slice(0, -5))])
  const out = Object.entries(config.slots ?? {}).filter(([, skill]) => skill && !known.has(skill)).map(([slot, skill]) => ({ level: 'warn', message: `slot "${slot}" is bound to "${skill}", which is neither in ${SKILLS}/ nor registered`, fix: `register it (${REGISTRY}/${skill}.json with origin plugin or builtin if it lives outside the repo) or rebind: agent-os config set slots.${slot} <skill>` }))
  return out.length ? out : [ok('every bound slot has its skill')]
}

/** The configuration is valid and the version pin matches what runs. */
function version({ cwd, config, running }) {
  if (!config.version) return [{ level: 'warn', message: 'agent-os.json does not pin a version, so teammates may run different ones', fix: `agent-os config set version ${running}` }]
  const s = versionStatus(config, { cwd, running })
  return s.ok ? [ok(`agent-os ${s.pinned}, pinned and running`)] : s.problems.map((p) => ({ level: 'warn', message: p.message, fix: p.fix }))
}

/** Personal state and caches are not committed. */
function gitignore({ cwd }) {
  const text = read(cwd, '.gitignore') ?? ''
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  const missing = GITIGNORE_ENTRIES.filter((e) => !lines.includes(e))
  if (!missing.length) return [ok('.gitignore keeps personal settings and caches out')]
  return [{ level: 'fail', path: '.gitignore', message: `.gitignore does not ignore ${missing.join(', ')}, so personal settings or caches can be committed`, fix: `add ${missing.join(' and ')} to .gitignore`, apply: () => { writeFileSync(join(cwd, '.gitignore'), `${text}${text && !text.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`); return `added ${missing.join(', ')} to .gitignore` } }]
}

/** Paths that are personal (per laptop) and must never be committed. */
export const PERSONAL = ['.agent-os/local.json', '.agent-os/cache/', '.claude/settings.local.json', '.claude/worktrees/']

/** git tracks none of the personal paths. Never fixed automatically: removing files from the index changes the team's tree. */
function personal({ cwd, git }) {
  const run = git ?? ((args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }); return { status: r.status, stdout: r.stdout ?? '' } })
  const r = run(['ls-files', '-z', '--', ...PERSONAL.map((p) => (p.endsWith('/') ? p.slice(0, -1) : p))])
  if (r.status !== 0) return [ok('not a git repository: nothing tracked')]
  const tracked = r.stdout.split('\0').filter(Boolean)
  if (!tracked.length) return [ok('no personal file is tracked by git')]
  const shown = tracked.slice(0, 5)
  return [{ level: 'fail', path: shown[0], message: `git tracks personal file(s): ${shown.join(', ')}${tracked.length > 5 ? `, +${tracked.length - 5}` : ''}`, fix: `untrack them in a change request (the files stay on your laptop): git rm --cached -r -- ${[...new Set(tracked.map((f) => PERSONAL.find((p) => f === p || f.startsWith(p)) ?? f))].map((p) => p.replace(/\/$/, '')).join(' ')}` }]
}

/** Legacy features the project keeps enabled are debt; deprecated items it still uses are listed with their replacement. */
function lifecycle({ cwd, config, templatesRoot = TEMPLATES, exceptions }) {
  let ex = exceptions
  if (!ex) { try { ex = readExceptions() } catch { ex = [] } }
  const known = legacyFeatures(templatesRoot)
  const out = []
  for (const id of config.legacy ?? []) {
    if (!known.includes(id)) { out.push({ level: 'fail', message: `legacy: "${id}" is not a legacy feature of this agent-os version`, fix: known.length ? `use one of ${known.join(', ')}, or remove it from legacy in agent-os.json` : 'remove it from legacy in agent-os.json (this version has no legacy features)' }); continue }
    const e = lifecycleOf(`legacy:${id}`, ex)
    out.push({ level: 'warn', message: `debt: the legacy feature "${id}" is enabled${e?.removeIn ? `; it is removed in ${e.removeIn}` : ''}`, fix: `${e?.replacement ? `move to ${e.replacement}, then ` : ''}remove "${id}" from legacy in agent-os.json` })
  }
  let team = {}
  let local = {}
  try { team = JSON.parse(read(cwd, 'agent-os.json') ?? '{}') } catch { /* config errors are reported elsewhere */ }
  try { local = JSON.parse(read(cwd, '.agent-os/local.json') ?? '{}') } catch { /* idem */ }
  let hookCommands = []
  try { hookCommands = Object.values(JSON.parse(read(cwd, '.claude/settings.json') ?? '{}').hooks ?? {}).flat().flatMap((g) => (g.hooks ?? []).map((h) => h.command ?? '')) } catch { /* idem */ }
  const manifest = { items: Object.fromEntries(ex.map((e) => [e.id, e])) }
  for (const d of deprecatedInUse(manifest, { team, local, hookCommands })) out.push({ level: 'warn', message: `this project uses ${noticeFor(d.id, d)}`, fix: d.replacement ? `switch to ${d.replacement.replace(/^(command|flag|config):/, '')}` : 'see the release notes for what replaces it' })
  return out.length ? out : [ok('no legacy feature enabled and no deprecated item in use')]
}

/** No unresolved update conflicts. */
function conflicts({ cwd }) {
  const rej = walk(cwd).filter((p) => p.endsWith('.rej'))
  return rej.length ? rej.map((p) => ({ level: 'fail', path: p, message: `${p} holds an unresolved update conflict`, fix: `merge what you want from ${p} into the file it belongs to by hand, then delete ${p}` })) : [ok('no unresolved .rej files')]
}

const MD_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

/** Relative links in the agent system's Markdown resolve. */
function links({ cwd }) {
  const files = ['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'README.md', ...walk(cwd, '.claude'), ...walk(cwd, 'docs')].filter((p, i, a) => p.endsWith('.md') && a.indexOf(p) === i && existsSync(join(cwd, p)))
  const out = []
  for (const f of files) {
    const text = read(cwd, f).replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
    for (const m of text.matchAll(MD_LINK)) {
      const target = m[1]
      if (/^([a-z]+:|#|mailto:)/i.test(target) || target.includes('{{')) continue
      const path = decodeURIComponent(target.split('#')[0])
      if (!path) continue
      const abs = path.startsWith('/') ? join(cwd, path) : resolve(cwd, dirname(f), path)
      if (!existsSync(abs)) out.push({ level: 'fail', path: f, message: `${f}: the link to ${target} is broken`, fix: `point it at an existing file (${relative(cwd, abs).split('\\').join('/')} does not exist)` })
    }
  }
  return out.length ? out : [ok(`links in ${files.length} Markdown file(s) resolve`)]
}

/** `agent-os <command>` in skills, rules and AGENTS.md names a real command; planned ones are flagged. */
function commands({ cwd }) {
  const files = ['AGENTS.md', ...walk(cwd, '.claude')].filter((p) => p.endsWith('.md') && existsSync(join(cwd, p)))
  const out = []
  const seen = new Set()
  for (const f of files) {
    for (const m of read(cwd, f).matchAll(/\bagent-os\s+([a-z][\w-]*)/g)) {
      const name = m[1]
      const key = `${f}:${name}`
      if (seen.has(key) || ['is', 'and', 'or', 'in', 'to', 'the', 'itself'].includes(name)) continue
      seen.add(key)
      const c = COMMANDS.find((x) => x.name === name)
      if (!c) out.push({ level: 'fail', path: f, message: `${f} calls "agent-os ${name}", which is not a command`, fix: `use one of: ${COMMANDS.filter((x) => x.load).map((x) => x.name).join(', ')}` })
      else if (!c.load) out.push({ level: 'warn', path: f, message: `${f} calls "agent-os ${name}", which is planned (#${c.issue}) and not available yet`, fix: `keep a manual fallback in the skill until #${c.issue} ships` })
    }
  }
  return out.length ? out : [ok(`commands named in ${files.length} file(s) exist`)]
}

/** .claude/settings.json is valid and its agent-os hooks call the pinned version. */
function hooks({ cwd, config }) {
  const text = read(cwd, '.claude/settings.json')
  if (text === null) return [{ level: 'warn', message: '.claude/settings.json does not exist, so no hooks run (guards, session context)', fix: 'agent-os update (or init) installs the hooks block' }]
  let settings
  try { settings = JSON.parse(text) } catch { return [{ level: 'fail', path: '.claude/settings.json', message: '.claude/settings.json is not valid JSON', fix: 'fix its syntax; Claude Code ignores the whole file otherwise' }] }
  const cmds = Object.values(settings.hooks ?? {}).flat().flatMap((g) => g.hooks ?? []).map((h) => h.command ?? '').filter((c) => /agent-os/.test(c))
  if (!cmds.length) return [{ level: 'warn', message: 'no agent-os hooks in .claude/settings.json', fix: 'agent-os update reinstalls them' }]
  const unpinned = cmds.filter((c) => /npx\s+(-y\s+)?@?[\w/-]*agent-os(?!@)/.test(c) || (config.version && /agent-os@/.test(c) && !c.includes(`@${config.version}`)))
  return unpinned.length ? [{ level: 'fail', path: '.claude/settings.json', message: `${unpinned.length} hook(s) do not run the pinned version ${config.version ?? ''}`.trim(), fix: 'agent-os update --relock, then agent-os update (it rewrites the hooks block with the pinned command)' }] : [ok(`${cmds.length} hook(s), on the pinned version`)]
}

const DEFAULT_BUDGETS = { 'AGENTS.md': '8KB', 'CLAUDE.md': '8KB', '.claude/rules/**/*.md': '6KB' }
const bytes = (s) => { const m = String(s).match(/^(\d+(?:\.\d+)?)\s?(B|KB|MB)$/); return m ? Number(m[1]) * { B: 1, KB: 1024, MB: 1024 ** 2 }[m[2]] : Infinity }

/** Files agents load every session stay within their size budgets (warn at 80%). */
function budgets({ cwd, config }) {
  const all = { ...DEFAULT_BUDGETS, ...(config.contextBudgets ?? {}) }
  const files = walk(cwd)
  const out = []
  for (const [glob, size] of Object.entries(all)) {
    const limit = bytes(size)
    for (const f of files.filter((p) => matches(p, glob))) {
      const n = statSync(join(cwd, f)).size
      if (n > limit) out.push({ level: 'fail', path: f, message: `${f} is ${(n / 1024).toFixed(1)} KB, over its ${size} budget`, fix: 'split it by topic (move detail into a file read on demand); do not raise the budget' })
      else if (n > 0.8 * limit) out.push({ level: 'warn', path: f, message: `${f} is ${(n / 1024).toFixed(1)} KB, ${Math.round((100 * n) / limit)}% of its ${size} budget`, fix: 'plan a split before it overflows' })
    }
  }
  return out.length ? out : [ok('every budgeted file is within its budget')]
}

/** Files that belong to an area, for the ro ASCII rule. */
const AREA_FILES = {
  prs: ['.github/pull_request_template.md', '.gitlab/merge_request_templates/*.md'],
  issues: ['.github/ISSUE_TEMPLATE/*', '.gitlab/issue_templates/*'],
  docs: ['docs/**/*.md'],
}

/** Areas set to ro contain no diacritics. */
function language({ cwd, config }) {
  const out = []
  const files = walk(cwd)
  for (const [area, globs] of Object.entries(AREA_FILES)) {
    if (languageFor(config, area) !== 'ro') continue
    for (const f of files.filter((p) => globs.some((g) => matches(p, g)))) {
      const text = read(cwd, f)
      const found = findDiacritics(text)
      if (found.length) out.push({ level: 'fail', path: f, message: `${f}:${found[0].line}:${found[0].col}: "${found[0].char}" in a ro area (${area}); ${found.length} diacritic(s) in the file`, fix: `write "${found[0].ascii}"; doctor --fix replaces them all`, apply: () => { writeFileSync(join(cwd, f), toAscii(text)); return `replaced ${found.length} diacritic(s) in ${f}` } })
    }
  }
  return out.length ? out : [ok('ro areas are ASCII')]
}

/** Journal entries follow the schema (entries before the adoption cutoff are left alone). */
function journal({ cwd, config }) {
  const cutoff = config.adoption?.cutoff
  const entries = readJournal(cwd).filter((e) => !cutoff || !e.at || e.at.slice(0, 10) >= cutoff)
  const lang = languageFor(config, 'journal')
  const out = entries.flatMap((e) => validateEntry(e, { lang }).map((p) => ({ level: 'fail', path: e.path, message: `${e.path}: ${p}`, fix: 'fix the front matter or the name (agent-os journal check lists them all)' })))
  return out.length ? out : [ok(`${entries.length} journal entr${entries.length === 1 ? 'y' : 'ies'}, all valid`)]
}

/** Lesson cards follow the schema; the inbox does not pile up unnoticed. */
function lessons({ cwd, config }) {
  const cards = readLessons(cwd)
  const lang = languageFor(config, 'docs')
  const out = cards.flatMap((c) => validateCard(c, { lang }).map((p) => ({ level: 'fail', path: c.path, message: `${c.path}: ${p}`, fix: 'fix the front matter (agent-os lessons check lists them all)' })))
  const inbox = cards.filter((c) => c.state === 'inbox').length
  if (inbox >= 10) out.push({ level: 'warn', message: `${inbox} lessons wait in the inbox`, fix: 'triage them: /lessons review (or /retro)' })
  return out.length ? out : [ok(`${cards.length} lesson card(s), all valid${inbox ? `, ${inbox} in the inbox` : ''}`)]
}

/** Decision records have a date-based name, a status and their sections; a superseded one links its successor. */
function decisions({ cwd }) {
  const r = checkDecisions(cwd)
  const out = r.problems.map((p) => ({ level: 'fail', path: p.path, message: `${p.path}: ${p.message}`, fix: p.fix }))
  return out.length ? out : [ok(`${r.records} decision record(s), all valid`)]
}

/** AGENTS.md has an area map that covers every top-level source directory. */
function areaMap({ cwd }) {
  const text = read(cwd, 'AGENTS.md')
  if (text === null) return [{ level: 'warn', message: 'there is no AGENTS.md, so agents start without a map of the repository', fix: 'add AGENTS.md with what an agent cannot infer and a table of the top-level areas' }]
  const listed = [...text.matchAll(/^\|\s*`([^`]+)`/gm)].map((m) => m[1].replace(/^\.\//, ''))
  const top = dirs(cwd, '.').filter((d) => !d.startsWith('.') && !['node_modules', 'dist', 'build', 'coverage', '_site'].includes(d))
  const missing = top.filter((d) => !listed.some((p) => p === d || p.startsWith(`${d}/`)))
  return missing.length ? [{ level: 'warn', path: 'AGENTS.md', message: `the AGENTS.md area map does not mention ${missing.map((d) => `${d}/`).join(', ')}`, fix: 'add one table row per missing directory: | `dir/` | what it holds |' }] : [ok(`the area map covers ${top.length} top-level director${top.length === 1 ? 'y' : 'ies'}`)]
}

// ── Platform checks ────────────────────────────────────────────────────────

/** Open issues have a type, a priority and a milestone; blocked ones have an open blocker. */
function issues({ tracker, config, caps }) {
  const cutoff = config.adoption?.cutoff
  const open = tracker.openIssues().filter((i) => !cutoff || !i.createdAt || i.createdAt.slice(0, 10) >= cutoff)
  const out = []
  for (const i of open) {
    const ids = i.labels.map(labelId)
    const missing = [!ids.some((l) => l.startsWith('type:')) && 'a type label', !ids.includes('type:epic') && !ids.some((l) => l.startsWith('priority:')) && 'a priority label', !i.milestone && 'a milestone'].filter(Boolean)
    if (missing.length) out.push({ level: 'warn', message: `#${i.number} is missing ${missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}` : missing[0]}`, fix: `agent-os issue update ${i.number} --label <type> --label <priority> --milestone "<milestone>"` })
    if (ids.includes('blocked') && caps?.dependencies?.value && !tracker.blockers(i.number).some((b) => b.state === 'open')) out.push({ level: 'warn', message: `#${i.number} has the blocked label but no open blocker`, fix: `agent-os issue block ${i.number} --blocked-by <n>, or remove the label` })
  }
  return out.length ? out : [ok(`${open.length} open issue(s), each with a type, priority and milestone`)]
}

/** The labels the conventions use exist on the platform. */
function labels({ tracker, config }) {
  if (!tracker.labels) return []
  const have = new Set(tracker.labels())
  const missing = labelSet(config).map((l) => l.name).filter((n) => !have.has(n))
  return missing.length ? [{ level: 'warn', message: `${missing.length} convention label(s) are missing on the platform: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', …' : ''}`, fix: 'agent-os setup --only labels --dry-run, then run it without --dry-run' }] : [ok('every convention label exists')]
}

/** Open change requests have titles in convention. */
function titles({ tracker, config, me }) {
  const prs = tracker.pullRequests(`author:${me}`)
  const out = prs.flatMap((p) => {
    const s = tracker.pullRequestStatus ? tracker.pullRequestStatus(p.number) : { title: p.title, body: '' }
    const r = checkTitle(s.title ?? p.title, s.body ?? '', config.conventions, { lang: languageFor(config, 'prs') })
    return r.ok ? [] : [{ level: 'warn', message: `${p.title}: ${r.problems[0]}`, fix: r.suggestion ? `retitle it: ${r.suggestion}` : 'agent-os check title --pr <n>' }]
  })
  return out.length ? out : [ok(`${prs.length} open change request(s) of yours, titles in convention`)]
}

/** The registry of checks, in the order they are reported. */
export const CHECKS = [
  { id: 'skills', area: 'agent system', run: skills },
  { id: 'slots', area: 'agent system', run: slots },
  { id: 'commands', area: 'agent system', run: commands },
  { id: 'hooks', area: 'agent system', run: hooks },
  { id: 'links', area: 'agent system', run: links },
  { id: 'area-map', area: 'agent system', run: areaMap },
  { id: 'budgets', area: 'context', run: budgets },
  { id: 'language', area: 'language', run: language },
  { id: 'journal', area: 'history', run: journal },
  { id: 'lessons', area: 'history', run: lessons },
  { id: 'decisions', area: 'history', run: decisions },
  { id: 'conflicts', area: 'updates', run: conflicts },
  { id: 'version', area: 'updates', run: version },
  { id: 'lifecycle', area: 'updates', run: lifecycle },
  { id: 'gitignore', area: 'repository', run: gitignore },
  { id: 'personal', area: 'repository', run: personal },
  { id: 'issues', area: 'platform', platform: true, run: issues },
  { id: 'labels', area: 'platform', platform: true, run: labels },
  { id: 'titles', area: 'platform', platform: true, run: titles },
]
