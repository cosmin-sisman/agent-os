// `agent-os system`: the system map. `detect` drafts system.yaml from the repository's shape (workspace packages as
// components, their dependencies as edges, each with its evidence) and lists what it could not read; `check`
// validates system.yaml; `show` prints its components and edges.

import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError, EXIT } from '../cli/errors.mjs'
import { FILE, readSystem, validateSystem } from '../system/system.mjs'
import { detectSystem, systemYaml } from '../system/detect.mjs'
import { loadCatalog } from '../stack/catalog.mjs'
import { readStack } from '../stack/stack.mjs'

export const usage = 'agent-os system detect [--write] | check | show   (endpoints, checks, contract diffs: later issues)'

export const options = {
  write: { type: 'boolean', description: 'detect: write system.yaml (only when there is none)' },
}

const knownLayers = (cwd) => { const s = readStack(cwd); return s?.layers ? Object.keys(s.layers) : [...loadCatalog({ cwd }).layers.keys()] }

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action] = ctx.positionals
  if (action === 'detect') {
    const d = detectSystem(ctx.cwd)
    const lines = [`shape: ${d.shape}${d.tools.length ? ` (${d.tools.join(', ')})` : ''}, ${Object.keys(d.components).length} component(s)`]
    for (const [id, c] of Object.entries(d.components)) lines.push(`  ${id.padEnd(20)} ${c.kind.padEnd(8)} ${c.path}${c.layer ? `  [${c.layer}]` : ''}${c.exposure ? `  ${c.exposure}` : ''}${c.consumes.length ? `  → ${c.consumes.join(', ')}` : ''}\n  ${''.padEnd(20)} evidence: ${c.evidence.join(', ')}`)
    if (d.questions.length) lines.push('', 'to answer (system.yaml cannot be read from the code):', ...d.questions.map((q) => `  - ${q}`))
    if (ctx.values.write) {
      if (existsSync(join(ctx.cwd, FILE))) throw new CliError(`${FILE} already exists: detect never overwrites it`, { hint: 'agent-os system check validates it; edit it by hand' })
      if (!ctx.dryRun) writeFileSync(join(ctx.cwd, FILE), systemYaml(d))
      lines.push('', `${ctx.dryRun ? 'would write' : 'wrote'} ${FILE}: answer the questions in it, then agent-os system check`)
    }
    ctx.output(d, lines.join('\n'))
    return EXIT.OK
  }
  const system = readSystem(ctx.cwd)
  if (!system) throw new CliError(`there is no ${FILE}`, { hint: 'agent-os system detect --write drafts one from the repository' })
  const v = validateSystem(system, { layers: knownLayers(ctx.cwd) })
  for (const w of v.warnings) ctx.io.stderr(`agent-os: warning: ${w}\n`)
  if (action === 'check') {
    ctx.output(v, v.problems.length ? `${FILE}: ${v.problems.length} problem(s)\n  - ${v.problems.join('\n  - ')}` : `${FILE}: valid${v.warnings.length ? ` (${v.warnings.length} warning(s))` : ''}`)
    return v.problems.length ? EXIT.CHECK_FAILED : EXIT.OK
  }
  if (action === 'show') {
    const comps = Object.entries(system.components ?? {})
    ctx.output({ components: system.components ?? {}, ...v }, comps.map(([id, c]) => `${id.padEnd(20)} ${String(c.kind ?? '?').padEnd(8)} ${c.path ?? c.repo ?? '-'}${c.exposure ? `  ${c.exposure}` : ''}${(c.consumes ?? []).length ? `  → ${c.consumes.join(', ')}` : ''}`).join('\n') || 'no components')
    return v.problems.length ? EXIT.CHECK_FAILED : EXIT.OK
  }
  throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
}
