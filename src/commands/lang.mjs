// `agent-os lang`: shows the language of every area, checks text for diacritics in ro areas, and prints the
// language rule agents follow. `set` changes an area's language; for labels and milestones it also renames them on the
// platform in place (through setup), so they stay on their issues.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig, validate, saveJson, TEAM_FILE, LOCAL_FILE } from '../config/config.mjs'
import { runSetup } from './setup.mjs'
import { AREAS, LANGUAGES, languageFor, findDiacritics, renderLanguageRule } from '../i18n/i18n.mjs'

export const usage = 'agent-os lang [show | set <area> <en|ro> [--dry-run] | check <file...> [--area <area>] [--text <text>] | rule]'

export const options = {
  area: { type: 'string', description: 'Only check when this area is set to ro' },
  text: { type: 'string', description: 'Check this text instead of files' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export function run(ctx) {
  const [action = 'show', ...files] = ctx.positionals
  const { merged } = loadConfig(ctx.cwd)
  if (action === 'show') {
    const rows = AREAS.map((a) => ({ area: a.id, language: languageFor(merged, a.id), personal: a.personal }))
    const width = Math.max(...rows.map((r) => r.area.length))
    return ctx.output(rows, rows.map((r) => `${r.area.padEnd(width)}  ${r.language}${r.personal ? '  (personal)' : ''}`).join('\n'))
  }
  if (action === 'rule') return ctx.output(renderLanguageRule(merged))
  if (action === 'check') return check(ctx, merged, files)
  if (action === 'set') return set(ctx, files[0], files[1])
  throw new CliError(`unknown action "${action}"`, { hint: `usage: ${usage}` })
}

function check(ctx, config, files) {
  const area = ctx.values.area
  if (area && languageFor(config, area) !== 'ro') {
    ctx.output({ area, language: languageFor(config, area), findings: [] }, `${area} is written in ${languageFor(config, area)}: nothing to check`)
    return EXIT.OK
  }
  const inputs = ctx.values.text !== undefined
    ? [{ file: '<text>', text: ctx.values.text }]
    : files.map((f) => {
      try { return { file: f, text: readFileSync(resolve(ctx.cwd, f), 'utf8') } } catch { throw new CliError(`cannot read ${f}`) }
    })
  if (!inputs.length) throw new CliError('nothing to check', { hint: 'pass files, or --text "..."' })
  const findings = inputs.flatMap(({ file, text }) => findDiacritics(text).map((f) => ({ file, ...f })))
  const lines = findings.map((f) => `${f.file}:${f.line}:${f.col}: "${f.char}" is a diacritic; write "${f.ascii}" (ro is ASCII only)`)
  ctx.output({ findings }, findings.length ? lines.join('\n') : 'no diacritics found')
  return findings.length ? EXIT.CHECK_FAILED : EXIT.OK
}

function set(ctx, area, lang) {
  if (!AREAS.some((a) => a.id === area)) throw new CliError(`unknown language area "${area}"`, { hint: `areas: ${AREAS.map((a) => a.id).join(', ')}` })
  if (!LANGUAGES.includes(lang)) throw new CliError(`language must be one of ${LANGUAGES.join(', ')}, got "${lang ?? ''}"`)
  const personal = AREAS.find((a) => a.id === area).personal
  const { team, local } = loadConfig(ctx.cwd)
  const file = personal ? LOCAL_FILE : TEAM_FILE
  const current = structuredClone((personal ? local : team) ?? {})
  current.languages = { ...(current.languages ?? {}), [area]: lang }
  const problems = validate(current, { personal, file })
  if (problems.length) throw new CliError(problems.join('; '))
  if (!ctx.dryRun) saveJson(ctx.cwd, file, current)
  if (area !== 'labels' && area !== 'milestones') return ctx.output({ area, language: lang, file, dryRun: ctx.dryRun }, `${ctx.dryRun ? 'would set' : 'set'} ${area} to ${lang} in ${file}`)
  const merged = loadConfig(ctx.cwd).merged
  merged.languages[area] = lang
  return runSetup(ctx, merged, [area])
}
