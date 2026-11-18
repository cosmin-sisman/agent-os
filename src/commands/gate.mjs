// `agent-os gate`: run the suites the current diff needs (from "gate" and "gatePaths"), print a results table and
// save the result for `agent-os pr`. Exit 1 when a suite fails.

import { EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { resultsTable, runGate } from '../gate/gate.mjs'
import { systemGit } from '../workflow/start.mjs'

export const usage = 'agent-os gate [--base <branch>] [--all] [--suite <name>…] [--dry-run]'

export const options = {
  base: { type: 'string', description: 'Compare against origin/<base> (default: branches.integration)' },
  all: { type: 'boolean', description: 'Run every suite, whatever changed' },
  suite: { type: 'string', multiple: true, description: 'Run only this suite (repeat for several)' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const { merged } = loadConfig(ctx.cwd)
  const r = runGate({ config: merged, git: ctx.io.git ?? systemGit(ctx.cwd), cwd: ctx.cwd, exec: ctx.io.exec }, { base: ctx.values.base ?? merged.branches.integration, all: ctx.values.all, only: ctx.values.suite ?? [], dryRun: ctx.dryRun })
  for (const w of r.warnings) ctx.io.stderr(`agent-os: warning: ${w}\n`)
  if (r.dryRun) {
    ctx.output(r, r.suites.length ? `would run: ${r.suites.map((s) => `${s} (${merged.gate[s]})`).join(', ')}` : 'no suite would run')
    return EXIT.OK
  }
  const failed = r.suites.filter((s) => !s.passed)
  ctx.output(r, [resultsTable(r), ...failed.map((s) => `\n${s.name} failed:\n${s.tail}`), '', r.ok ? 'gate: passed' : `gate: failed (${failed.map((s) => s.name).join(', ')})`].join('\n'))
  return r.ok ? EXIT.OK : EXIT.CHECK_FAILED
}
