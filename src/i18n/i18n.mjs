// The language engine: which language each area uses, the core label and milestone dictionaries, the ASCII rule
// for Romanian, and the rule text that tells agents where to write which language (design §4).

import { readFileSync } from 'node:fs'
import { SCHEMA } from '../config/schema.mjs'
import { parse } from '../yaml/yaml.mjs'
import { CliError } from '../cli/errors.mjs'

export const LANGUAGES = ['en', 'ro']

/** Every language area, in the order the schema defines them, with whether it is personal. */
export const AREAS = Object.entries(SCHEMA.properties.languages.properties).map(([id, node]) => ({ id, personal: Boolean(node.personal), description: node.description }))

/** What each area covers, for the rule text and `agent-os lang`. */
const COVERS = {
  chat: 'how the agent talks to you',
  issues: 'issue titles, bodies and the comments the agent starts on issues',
  prs: 'pull or merge request titles, descriptions and the comments the agent starts on them',
  commits: 'commit messages',
  branches: 'branch slugs (always lowercase ASCII kebab-case)',
  labels: 'label names and descriptions',
  milestones: 'milestone titles and descriptions',
  releases: 'release notes and release titles',
  codeComments: 'comments and file headers written in code',
  docs: 'human documentation in docs/',
  journal: 'journal entries and decision records',
}

/**
 * The language of one area in a merged configuration (see src/config).
 * @param {{ languages: Record<string, string> }} config
 * @param {string} area
 */
export function languageFor(config, area) {
  if (!AREAS.some((a) => a.id === area)) throw new CliError(`unknown language area "${area}"`, { hint: `areas: ${AREAS.map((a) => a.id).join(', ')}` })
  return config.languages?.[area] ?? 'en'
}

// ── Dictionaries ───────────────────────────────────────────────────────────

const load = (name) => parse(readFileSync(new URL(`./${name}.yaml`, import.meta.url), 'utf8'), { file: `src/i18n/${name}.yaml` })
export const LABELS = load('labels')
export const MILESTONES = load('milestones')

/**
 * A core label rendered for a language and platform.
 * @param {string} id stable id such as `type:bug`
 * @param {'en' | 'ro'} lang
 * @param {{ scoped?: boolean }} [options] scoped: use the platform's exclusive-label form (`type::bug` on GitLab)
 */
export function label(id, lang, { scoped = false } = {}) {
  const entry = LABELS.find((l) => l.id === id)
  if (!entry) throw new CliError(`unknown core label "${id}"`)
  const name = entry.name[lang]
  // Colors are quoted in labels.yaml; String/padStart also guards against an unquoted 000000 read as the number 0.
  return { id, color: String(entry.color).padStart(6, '0'), name: scoped ? name.replace(':', '::') : name, description: entry.description[lang] }
}

/** Every core label for the configured `labels` language. */
export const labelSet = (config, options) => LABELS.map((l) => label(l.id, languageFor(config, 'labels'), options))

/** A core milestone title and description, with {n} and {date} filled in. */
export function milestone(id, lang, vars = {}) {
  const entry = MILESTONES.find((m) => m.id === id)
  if (!entry) throw new CliError(`unknown core milestone "${id}"`)
  const fill = (s) => s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? `{${k}}` : String(vars[k])))
  return { id, title: fill(entry.title[lang]), description: fill(entry.description[lang]) }
}

// ── ASCII rule for ro ──────────────────────────────────────────────────────

/** Romanian diacritics in every form (comma below and the legacy cedilla), mapped to their ASCII letter. */
export const DIACRITICS = {
  'ă': 'a', 'â': 'a', 'î': 'i', 'ș': 's', 'ț': 't', 'ş': 's', 'ţ': 't',
  'Ă': 'A', 'Â': 'A', 'Î': 'I', 'Ș': 'S', 'Ț': 'T', 'Ş': 'S', 'Ţ': 'T',
}
const DIACRITIC_RE = new RegExp(`[${Object.keys(DIACRITICS).join('')}]`, 'g')

/**
 * Finds Romanian diacritics, which `ro` areas must not contain. Decomposed forms (a letter plus a combining
 * breve, circumflex, comma or cedilla) are normalized first, so they are found too.
 * @param {string} text
 * @returns {{ line: number, col: number, char: string, ascii: string }[]}
 */
export function findDiacritics(text) {
  const out = []
  text.normalize('NFC').split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(DIACRITIC_RE)) out.push({ line: i + 1, col: m.index + 1, char: m[0], ascii: DIACRITICS[m[0]] })
  })
  return out
}

/** Replaces Romanian diacritics with their ASCII letters. */
export const toAscii = (text) => text.normalize('NFC').replace(DIACRITIC_RE, (c) => DIACRITICS[c])

// ── Rule text for agents ───────────────────────────────────────────────────

const NAME = { en: 'English', ro: 'Romanian without diacritics (ASCII only: plain a, i, s, t instead of the accented letters)' }

/**
 * The language rule installed for agents (.claude/rules/language.md), rendered from the configuration.
 * @param {{ languages: Record<string, string> }} config merged configuration
 */
export function renderLanguageRule(config) {
  const rows = AREAS.map((a) => `| ${a.id}${a.personal ? ' (personal)' : ''} | ${COVERS[a.id]} | ${NAME[languageFor(config, a.id)]} |`)
  const anyRo = AREAS.some((a) => languageFor(config, a.id) === 'ro')
  return [
    '# Language',
    '',
    'Which language to write in, by area. Generated by agent-os from agent-os.json and your .agent-os/local.json; change it with `agent-os config set languages.<area> <en|ro>`.',
    '',
    '| Area | Covers | Write in |',
    '|---|---|---|',
    ...rows,
    '',
    '- Code identifiers, file names, routes and database names are always English, whatever the areas say.',
    '- A reply to an existing comment uses the language of that comment.',
    '- Code, commands, file names and error messages stay verbatim, in backticks, inside text of any language.',
    ...(anyRo ? ['- Romanian here means ASCII only. `agent-os lang check` finds diacritics, and CI rejects them in `ro` areas, because they break branch names, searches and some terminals.'] : []),
    '',
  ].join('\n')
}
