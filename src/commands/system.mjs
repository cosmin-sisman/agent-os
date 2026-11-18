// `agent-os system`: the system map. `detect` drafts system.yaml from the repository's shape (workspace packages as
// components, their dependencies as edges, each with its evidence) and lists what it could not read; `check`
// validates system.yaml; `show` prints its components and edges.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError, EXIT } from '../cli/errors.mjs'
import { FILE, readSystem, validateSystem } from '../system/system.mjs'
import { detectSystem, systemYaml } from '../system/detect.mjs'
import { loadCatalog } from '../stack/catalog.mjs'
import { readStack } from '../stack/stack.mjs'
import { contractReview } from '../system/contracts.mjs'
import { changedFiles } from '../gate/gate.mjs'
import { systemGit } from '../workflow/start.mjs'
import { loadConfig } from '../config/config.mjs'
import { createTracker } from '../tracker/tracker.mjs'

export const usage = 'agent-os system detect [--write] | check | show | contracts [--base <branch>]   (endpoints, checks: later issues)'

export const options = {
  write: { type: 'boolean', description: 'detect: write system.yaml (only when there is none)' },
  base: { type: 'string', description: 'contracts: the branch to compare with (default branches.integration)' },
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
  if (action === 'contracts') {
    const { merged } = loadConfig(ctx.cwd)
    const git = ctx.io.git ?? systemGit(ctx.cwd)
    const base = ctx.values.base ?? merged.branches.integration
    const tracker = (() => { try { return ctx.io.tracker ?? (merged.platform?.project ? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab }) : null) } catch { return null } })()
    const r = contractReview({ git, tracker, readFile: (f) => { try { return readFileSync(join(ctx.cwd, f), 'utf8') } catch { return null } } }, { system, base, files: changedFiles(git, base) })
    const lines = r.changes.length ? r.changes.flatMap((c) => [`${c.spec} (${c.component}): ${c.breaking.length} breaking, ${c.other.length} other`, ...c.breaking.map((b) => `  BREAKING ${b}`), ...c.other.slice(0, 10).map((o) => `  ${o}`), ...(c.consumers.length ? [`  consumers: ${c.consumers.map((x) => `${x.id}${x.owners.length ? ` (${x.owners.join(', ')})` : ' (no owners)'}`).join(', ')}`] : [])]) : ['no contract that system.yaml names has changed']
    if (r.breaking) lines.push('', `pr create will label it contract:breaking and request reviews from ${r.owners.join(', ') || 'nobody (no consumer lists owners)'}`)
    ctx.output(r, lines.join('\n'))
    return r.breaking ? EXIT.CHECK_FAILED : EXIT.OK
  }
  if (action === 'show') {
    const comps = Object.entries(system.components ?? {})
    ctx.output({ components: system.components ?? {}, ...v }, comps.map(([id, c]) => `${id.padEnd(20)} ${String(c.kind ?? '?').padEnd(8)} ${c.path ?? c.repo ?? '-'}${c.exposure ? `  ${c.exposure}` : ''}${(c.consumes ?? []).length ? `  → ${c.consumes.join(', ')}` : ''}`).join('\n') || 'no components')
    return v.problems.length ? EXIT.CHECK_FAILED : EXIT.OK
  }
  throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
}
