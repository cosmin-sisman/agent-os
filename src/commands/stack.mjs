// `agent-os stack`: the stack map. `show` renders stack.yaml as a table with its summary (languages, providers,
// averages, steepest learning curve, EU region check); `check` validates it against the catalog, naming the closest
// id for unknown ones; `new --from <blueprint>` writes stack.yaml from a reference stack.

import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError, EXIT } from '../cli/errors.mjs'
import { ask } from '../cli/prompt.mjs'
import { parse } from '../yaml/yaml.mjs'
import { closest } from '../util/closest.mjs'
import { loadCatalog, readStack, stackFromBlueprint, stackSummary, validateStack } from '../stack/stack.mjs'

export const usage = 'agent-os stack show | check | new --from <blueprint> [--project <name>] [--force] [--dry-run]   (set, status, detect, drift, import, render: later issues)'

export const options = {
  from: { type: 'string', description: 'new: the blueprint id (catalog/blueprints.yaml)' },
  project: { type: 'string', description: 'new: the project name' },
  force: { type: 'boolean', description: 'new: replace an existing stack.yaml' },
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
  const [action] = ctx.positionals
  const catalog = loadCatalog()
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
