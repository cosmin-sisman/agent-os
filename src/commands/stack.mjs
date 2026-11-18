// `agent-os stack`: the stack map. `show` renders stack.yaml as a table with its summary (languages, providers,
// averages, steepest learning curve, EU region check); `check` validates it against the catalog, naming the closest
// id for unknown ones; `new --from <blueprint>` writes stack.yaml from a reference stack.

import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError, EXIT } from '../cli/errors.mjs'
import { ask } from '../cli/prompt.mjs'
import { parse } from '../yaml/yaml.mjs'
import { closest } from '../util/closest.mjs'
import { catalogFiles, KINDS, mergeCatalog, problemText, validateCatalog } from '../stack/catalog.mjs'
import { changeLayer } from '../stack/change.mjs'
import { compareTech, proposeBlueprints } from '../stack/propose.mjs'
import { detectStack, stackDrift, stackFromDetections } from '../stack/detect.mjs'
import { importSheet, readSheets, stackFromImport, writeOverlay } from '../stack/import.mjs'
import { basename, resolve } from 'node:path'
import { loadConfig } from '../config/config.mjs'
import { languageFor } from '../i18n/i18n.mjs'
import { loadCatalog, readStack, stackFromBlueprint, stackSummary, validateStack } from '../stack/stack.mjs'

export const usage = 'agent-os stack show | check | catalog [check] | new --from <blueprint> [--project <name>] [--force] [--dry-run] | set <layer> <tech> [--why <text>] | status <layer> <status> [--why <text>] | detect [--write] | drift | import <file.csv|file.xlsx> [--sheet <name>] [--write [--force]] [--overlay] | propose --level <1-5> [--family typescript|polyglot] | compare <tech> <tech>   (render: later)'

export const options = {
  from: { type: 'string', description: 'new: the blueprint id (catalog/blueprints.yaml)' },
  project: { type: 'string', description: 'new: the project name' },
  force: { type: 'boolean', description: 'new: replace an existing stack.yaml' },
  why: { type: 'string', description: 'set, status: why, for the decision record' },
  write: { type: 'boolean', description: 'detect, import: write stack.yaml (only when there is none, or with --force for import)' },
  sheet: { type: 'string', description: 'import: the sheet to read (default: the first with Layer and Technology columns)' },
  level: { type: 'string', description: 'propose: the product complexity level, 1 (simple) to 5 (complex)' },
  family: { type: 'string', description: 'propose: typescript (one language end to end) or polyglot' },
  overlay: { type: 'boolean', description: 'import: add the technologies and layers the catalog lacks to .agent-os/catalog/' },
}

const pad = (rows) => {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)))
  return rows.map((r) => r.map((c, i) => String(c).padEnd(w[i])).join('  ').trimEnd()).join('\n')
}

function showText(rows, s) {
  const table = pad([['LAYER', 'TECH', 'LANGUAGE', 'PROVIDER', 'STATUS', 'PATHS'], ...rows.map((r) => [r.layer, r.techName ?? '-', r.language ?? '-', r.provider ?? '-', r.status, r.paths.join(', ') || '-'])])
  const lines = [
    table,
    '',
    `in use: ${s.layers} layer(s)`,
    `languages (${s.languages.length}): ${s.languages.join(', ') || '-'}`,
    `providers (${s.providers.length}): ${s.providers.join(', ') || '-'}`,
    `average complexity: ${s.averageComplexity ?? '-'} / 5   AI-friendliness: ${s.averageAiFriendly ?? '-'} / 5   provider cost: ${s.averageProviderCost ?? '-'} / 5`,
    `steepest learning curve: ${s.steepestLearningCurve ? `${s.steepestLearningCurve.language} (${s.steepestLearningCurve.learningCurve} / 5)` : '-'}`,
  ]
  if (s.eu.euOnly) lines.push(s.eu.flagged.length ? `EU only: ${s.eu.flagged.length} provider(s) to verify: ${s.eu.flagged.map((f) => `${f.provider} (${f.layer}, euRegions ${f.euRegions})`).join(', ')}; confirm their EU regions before strict GDPR work` : 'EU only: every provider has EU regions')
  return lines.join('\n')
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action, sub] = ctx.positionals
  if (action === 'catalog') {
    const files = catalogFiles({ cwd: ctx.cwd })
    const merged = mergeCatalog(files)
    const counts = Object.fromEntries(KINDS.map((k) => [k, merged[k].size]))
    const overlays = Object.values(files.overlays).map((f) => f.file)
    const problems = sub === 'check' ? validateCatalog(files) : []
    const head = `catalog: ${KINDS.map((k) => `${counts[k]} ${k}`).join(', ')}${overlays.length ? ` (overlays: ${overlays.join(', ')})` : ''}`
    ctx.output({ counts, overlays, problems }, problems.length ? `${head}
${problems.length} problem(s):
  ${problems.map(problemText).join('\n  ')}` : `${head}${sub === 'check' ? '\nvalid: unique ids, references resolve, en and ro present, ro ASCII only' : ''}`)
    return problems.length ? EXIT.CHECK_FAILED : EXIT.OK
  }
  const catalog = loadCatalog({ cwd: ctx.cwd })
  if (action === 'show' || action === 'check') {
    const stack = readStack(ctx.cwd)
    if (!stack) throw new CliError('there is no stack.yaml', { hint: 'agent-os stack new --from <blueprint> (blueprints: catalog/blueprints.yaml)' })
    const v = validateStack(stack, catalog)
    for (const w of v.warnings) ctx.io.stderr(`agent-os: warning: ${w}\n`)
    if (action === 'check') {
      ctx.output(v, v.problems.length ? `stack.yaml: ${v.problems.length} problem(s)\n  - ${v.problems.join('\n  - ')}` : `stack.yaml: valid against the catalog${v.warnings.length ? ` (${v.warnings.length} warning(s))` : ''}`)
      return v.problems.length ? EXIT.CHECK_FAILED : EXIT.OK
    }
    const { rows, summary } = stackSummary(stack, catalog)
    ctx.output({ rows, summary, problems: v.problems, warnings: v.warnings }, `${showText(rows, summary)}${v.problems.length ? `\n\nstack.yaml has ${v.problems.length} problem(s): agent-os stack check` : ''}`)
    return v.problems.length ? EXIT.CHECK_FAILED : EXIT.OK
  }
  if (action === 'detect') {
    const r = detectStack(ctx.cwd, { catalog })
    const lines = r.detections.length ? r.detections.map((d) => `${d.layer.padEnd(22)} ${d.name}  ← ${d.evidence.slice(0, 3).map((e) => (e.detail && e.detail !== 'file' ? `${e.file} (${e.detail})` : e.file)).join(', ')}${d.paths.length ? `  [${d.paths.join(', ')}]` : ''}`) : ['nothing detected: no manifests, configs or workflows the rules know']
    for (const p of r.providers) lines.push(`provider ${p.provider}  ← ${p.evidence.map((e) => e.file).join(', ')}`)
    if (ctx.values.write) {
      if (existsSync(join(ctx.cwd, 'stack.yaml'))) throw new CliError('stack.yaml already exists: detect never overwrites it', { hint: 'agent-os stack drift shows the differences; agent-os stack set changes a layer' })
      const text = stackFromDetections(r)
      if (!ctx.dryRun && r.detections.length) writeFileSync(join(ctx.cwd, 'stack.yaml'), text)
      lines.push('', ctx.dryRun ? text : r.detections.length ? 'wrote stack.yaml: check every layer and its paths, then agent-os stack check' : 'nothing to write')
    }
    ctx.output(r, lines.join('\n'))
    return EXIT.OK
  }
  if (action === 'propose') {
    const level = Number(ctx.values.level)
    if (!Number.isInteger(level) || level < 1 || level > 5) throw new CliError('--level must be 1 (simple) to 5 (complex)', { hint: 'agent-os stack propose --level 2' })
    if (ctx.values.family && !['typescript', 'polyglot'].includes(ctx.values.family)) throw new CliError('--family must be typescript or polyglot')
    const lang = languageFor(loadConfig(ctx.cwd).merged, 'docs')
    const list = proposeBlueprints(catalog, { level, family: ctx.values.family, lang })
    ctx.output(list, `${list.some((x) => !x.exact) ? `no blueprint for level ${level}; the nearest:\n` : ''}${list.map((x, i) => `${i + 1}. ${x.id} (${x.name}, level ${x.scores.level}, ${x.scores.family})\n   ${x.why}\n   start from it: agent-os stack new --from ${x.id}`).join('\n')}`)
    return EXIT.OK
  }
  if (action === 'compare') {
    const [, a, b] = ctx.positionals
    for (const id of [a, b]) if (!catalog.technologies.has(id ?? '')) { const near = closest(String(id ?? ''), [...catalog.technologies.keys()]); throw new CliError(`unknown technology "${id ?? ''}"${near ? ` (did you mean "${near}"?)` : ''}`, { hint: 'agent-os stack compare <tech> <tech>' }) }
    const r = compareTech(catalog, a, b)
    ctx.output(r, `${r.table}${r.reasons.length ? `\n\n${r.reasons.map((x) => `- ${x}`).join('\n')}` : ''}`)
    return EXIT.OK
  }
  if (action === 'import') {
    const file = ctx.positionals[1]
    if (!file) throw new CliError('which file?', { hint: 'agent-os stack import <file.csv|file.xlsx>' })
    const path = resolve(ctx.cwd, file)
    if (!existsSync(path)) throw new CliError(`${file} does not exist`)
    const r = importSheet(readSheets(path), { catalog, sheet: ctx.values.sheet })
    const text = stackFromImport(r, { source: basename(file) })
    for (const p of r.problems) ctx.io.stderr(`agent-os: warning: ${p}\n`)
    const unknown = [...r.suggestions.technologies.map((t) => `technology "${t.name}" → ${t.id}`), ...r.suggestions.layers.map((l) => `layer "${l.name.en}" → ${l.id}`)]
    const lines = [`sheet ${r.sheet}: ${r.layers.length} layer(s)${r.project ? `, project "${r.project}"` : ''}${r.level ? `, level ${r.level}` : ''}`]
    if (unknown.length) lines.push(`not in the catalog (overlay suggestions${ctx.values.overlay ? '' : ', add them with --overlay'}): ${unknown.join('; ')}`)
    if (ctx.values.write) {
      if (existsSync(join(ctx.cwd, 'stack.yaml')) && !ctx.values.force) throw new CliError('stack.yaml already exists', { hint: 'agent-os stack import … --write --force replaces it; agent-os stack set changes one layer' })
      if (!ctx.dryRun) writeFileSync(join(ctx.cwd, 'stack.yaml'), text)
      lines.push(`${ctx.dryRun ? 'would write' : 'wrote'} stack.yaml; add each layer's paths, then agent-os stack check`)
    } else lines.push('', text)
    if (ctx.values.overlay) { const w = ctx.dryRun ? [] : writeOverlay(ctx.cwd, r.suggestions); lines.push(w.length ? `added to the overlay: ${w.join(', ')} (fill in their attributes; agent-os stack catalog check)` : 'nothing to add to the overlay') }
    ctx.output({ ...r, text }, lines.join('\n'))
    return EXIT.OK
  }
  if (action === 'drift') {
    const r = stackDrift(ctx.cwd, { catalog })
    if (!r.stack) throw new CliError('there is no stack.yaml', { hint: 'agent-os stack detect --write drafts one from the code' })
    ctx.output(r, r.drift.length ? r.drift.map((d) => `${d.kind.padEnd(10)} ${d.message}\n           fix: ${d.fix}`).join('\n') : 'stack.yaml matches the code')
    return r.drift.length ? EXIT.CHECK_FAILED : EXIT.OK
  }
  if (action === 'set' || action === 'status') {
    const [, layer, value] = ctx.positionals
    if (!layer || !value) throw new CliError(`${action} needs a layer and a ${action === 'set' ? 'technology' : 'status'}`, { hint: `usage: ${usage}` })
    const r = changeLayer(ctx.cwd, catalog, { layer, ...(action === 'set' ? { tech: value } : { status: value }), why: ctx.values.why }, { lang: languageFor(loadConfig(ctx.cwd).merged, 'docs'), now: ctx.io.now ?? new Date(), dryRun: ctx.dryRun })
    if (!r.changed) { ctx.output(r, `nothing to change: ${r.reason}`); return EXIT.OK }
    const lines = [
      `${r.dryRun ? 'would change' : 'changed'} ${r.layer}: ${r.from.tech ?? '-'} (${r.from.status ?? '-'}) → ${r.to.tech ?? '-'} (${r.to.status})`,
      `${r.dryRun ? 'would write' : 'wrote'} the decision record ${r.decision} (proposed): ${r.after.name} vs ${r.before.name}, complexity ${r.before.complexity ?? '-'} → ${r.after.complexity ?? '-'}, AI-friendliness ${r.before.aiFriendly ?? '-'} → ${r.after.aiFriendly ?? '-'}, provider cost ${r.before.cost ?? '-'} → ${r.after.cost ?? '-'}`,
      ...(r.proposed.length ? ['', 'proposed follow-up issues (create them with /ticket or agent-os issue new):', ...r.proposed.map((p) => `  - ${p.title}`)] : []),
    ]
    ctx.output(r, lines.join('\n'))
    return EXIT.OK
  }
  if (action === 'new') {
    const id = ctx.values.from
    if (!id) throw new CliError('which blueprint?', { hint: `--from one of: ${[...catalog.blueprints.keys()].join(', ')}` })
    const bp = catalog.blueprints.get(id)
    if (!bp) { const near = closest(id, [...catalog.blueprints.keys()]); throw new CliError(`unknown blueprint "${id}"${near ? ` (did you mean "${near}"?)` : ''}`, { hint: `one of: ${[...catalog.blueprints.keys()].join(', ')}` }) }
    if (existsSync(join(ctx.cwd, 'stack.yaml')) && !ctx.values.force) throw new CliError('stack.yaml already exists', { hint: 'agent-os stack show, or --force to replace it' })
    const statuses = {}
    if (!ctx.dryRun && ctx.io.ask) {
      for (const row of bp.layers ?? []) {
        if (row.layer in statuses) continue
        const keep = await ask(ctx.io, { text: `${row.layer}: ${row.tech ?? row.detail ?? ''}, chosen now?`, kind: 'yesno', default: true })
        statuses[row.layer] = keep ? 'chosen' : 'optional'
      }
    }
    const text = stackFromBlueprint(bp, { project: ctx.values.project, statuses })
    const v = validateStack(parse(text, { file: 'stack.yaml' }), catalog)
    if (v.problems.length) throw new CliError(`the blueprint ${id} does not make a valid stack: ${v.problems.join('; ')}`)
    if (!ctx.dryRun) writeFileSync(join(ctx.cwd, 'stack.yaml'), text)
    ctx.output({ dryRun: ctx.dryRun, blueprint: id, layers: (bp.layers ?? []).length, text }, ctx.dryRun ? text : `wrote stack.yaml from ${id}; fill in each layer's paths, then agent-os stack show`)
    return EXIT.OK
  }
  throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
}
