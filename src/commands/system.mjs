// `agent-os system`: the system map. `detect` drafts system.yaml from the repository's shape (workspace packages as
// components, their dependencies as edges, each with its evidence) and lists what it could not read; `check`
// validates system.yaml; `show` prints its components and edges.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError, EXIT } from '../cli/errors.mjs'
import { FILE, readSystem, validateSystem } from '../system/system.mjs'
import { detectSystem, systemYaml } from '../system/detect.mjs'
import { loadCatalog } from '../stack/catalog.mjs'
import { readStack } from '../stack/stack.mjs'
import { contractReview } from '../system/contracts.mjs'
import { inventory } from '../system/endpoints.mjs'
import { systemChecks } from '../system/checks.mjs'
import { draftSpec } from '../system/docs.mjs'
import { dirname } from 'node:path'
import { changedFiles } from '../gate/gate.mjs'
import { systemGit } from '../workflow/start.mjs'
import { loadConfig } from '../config/config.mjs'
import { createTracker } from '../tracker/tracker.mjs'

export const usage = 'agent-os system detect [--write] | check | show | contracts [--base <branch>] | endpoints [--undocumented] | checks | spec <component> [--write <file>]'

export const options = {
  write: { type: 'boolean', description: 'detect: write system.yaml (only when there is none)' },
  base: { type: 'string', description: 'contracts: the branch to compare with (default branches.integration)' },
  'write-to': { type: 'string', description: 'spec: where to write the drafted OpenAPI file (default: print it)' },
  undocumented: { type: 'boolean', description: 'endpoints: only the routes no spec documents, and spec operations no code declares' },
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
  if (action === 'spec') {
    const component = ctx.positionals[1]
    if (!component) throw new CliError('which component?', { hint: 'agent-os system spec <component> [--write-to apps/api/openapi.json]' })
    const draft = draftSpec(ctx.cwd, component)
    const text = `${JSON.stringify(draft, null, 2)}\n`
    const n = Object.values(draft.paths).reduce((a, p) => a + Object.keys(p).length, 0)
    if (!n) throw new CliError(`no routes found for ${component}`, { hint: 'agent-os system endpoints lists the routes and their components' })
    const to = ctx.values['write-to']
    if (to) {
      if (existsSync(join(ctx.cwd, to))) throw new CliError(`${to} already exists: a draft never replaces a spec`)
      if (!ctx.dryRun) { mkdirSync(dirname(join(ctx.cwd, to)), { recursive: true }); writeFileSync(join(ctx.cwd, to), text) }
    }
    ctx.output(draft, to ? `${ctx.dryRun ? 'would write' : 'wrote'} ${to}: ${n} operation(s) drafted from the code; describe each, add the schemas, then list it under ${component}.provides in system.yaml` : text.trimEnd())
    return EXIT.OK
  }
  if (action === 'checks') {
    const findings = systemChecks(ctx.cwd)
    const order = { fail: 0, warn: 1 }
    const lines = [...findings].sort((a, b) => order[a.level] - order[b.level] || a.check.localeCompare(b.check)).map((f) => `${f.level === 'fail' ? 'FAIL' : 'warn'}  ${f.check.padEnd(17)} ${f.component ?? '-'}  ${f.file ?? '-'}\n      ${f.message}\n      fix: ${f.fix}`)
    const failed = findings.filter((f) => f.level === 'fail').length
    ctx.output({ findings }, `${lines.join('\n')}${lines.length ? '\n\n' : ''}system checks: ${failed} failing, ${findings.length - failed} warning(s)`)
    return failed ? EXIT.CHECK_FAILED : EXIT.OK
  }
  if (action === 'endpoints') {
    const inv = inventory(ctx.cwd)
    const cache = join(ctx.cwd, '.agent-os', 'cache')
    mkdirSync(cache, { recursive: true })
    writeFileSync(join(cache, 'endpoints.json'), `${JSON.stringify(inv, null, 2)}\n`)
    const list = ctx.values.undocumented ? inv.endpoints.filter((e) => !e.documented) : inv.endpoints
    const lines = list.map((e) => `${e.method.padEnd(7)} ${e.path.padEnd(32)} ${(e.component ?? '-').padEnd(12)} ${e.auth === 'marked' ? 'auth   ' : 'auth ? '} ${e.documented ? 'documented  ' : 'UNDOCUMENTED'}  ${e.file}:${e.line}`)
    if (inv.specOnly.length) lines.push('', 'in a spec but declared by no code:', ...inv.specOnly.map((o) => `  ${o.method} ${o.path}  (${o.spec})`))
    if (inv.unread.length) lines.push('', `not read (agent-os has no extractor for them yet): ${inv.unread.join(', ')}; their routes are missing from this list`)
    lines.push('', `${inv.endpoints.length} route(s) from ${inv.frameworks.join(', ') || 'no known framework'}; ${inv.endpoints.filter((e) => !e.documented).length} undocumented; specs: ${inv.specs.join(', ') || 'none'}. Cached in .agent-os/cache/endpoints.json (never committed).`)
    ctx.output(inv, lines.join('\n'))
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
