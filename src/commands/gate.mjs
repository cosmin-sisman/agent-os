// `agent-os gate`: run the suites the current diff needs (from "gate" and "gatePaths"), print a results table and
// save the result for `agent-os pr`. In CI (`--from-ci`) the base comes from the change request event, so the same
// selection runs locally and in CI; a push to a long-lived branch runs every suite. Exit 1 when a suite fails.

import { appendFileSync } from 'node:fs'
import { EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { fromCi } from '../ci/event.mjs'
import { resultsTable, runGate } from '../gate/gate.mjs'
import { systemGit } from '../workflow/start.mjs'

export const usage = 'agent-os gate [--base <branch>] [--all] [--suite <name>…] [--from-ci] [--dry-run]'

export const options = {
  base: { type: 'string', description: 'Compare against origin/<base> (default: branches.integration)' },
  all: { type: 'boolean', description: 'Run every suite, whatever changed' },
  suite: { type: 'string', multiple: true, description: 'Run only this suite (repeat for several)' },
  'from-ci': { type: 'boolean', description: 'In CI: the base from the change request event; a push runs every suite; results go to the job summary' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const { merged } = loadConfig(ctx.cwd)
  const env = ctx.io.env ?? process.env
  const ci = ctx.values['from-ci'] ? fromCi(env, { allowPush: true }) : null
  const base = ctx.values.base ?? ci?.base ?? merged.branches.integration
  const all = ctx.values.all || Boolean(ci?.push)
  const r = runGate({ config: merged, git: ctx.io.git ?? systemGit(ctx.cwd), cwd: ctx.cwd, exec: ctx.io.exec }, { base, all, only: ctx.values.suite ?? [], dryRun: ctx.dryRun })
  for (const w of r.warnings) ctx.io.stderr(`agent-os: warning: ${w}\n`)
  if (r.dryRun) {
    ctx.output(r, r.suites.length ? `would run: ${r.suites.map((s) => `${s} (${merged.gate[s]})`).join(', ')}` : 'no suite would run')
    return EXIT.OK
  }
  const failed = r.suites.filter((s) => !s.passed)
  const table = resultsTable(r)
  if (ci && env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(env.GITHUB_STEP_SUMMARY, `## agent-os gate\n\n${ci.push ? `Push to ${ci.ref ?? 'a branch'}: every suite.` : `Against ${base}: ${r.files.length} changed file(s).`}\n\n${table}\n`) } catch { /* the summary is a convenience */ }
  }
  ctx.output(r, [table, ...failed.map((s) => `\n${s.name} failed:\n${s.tail}`), '', r.ok ? 'gate: passed' : `gate: failed (${failed.map((s) => s.name).join(', ')})`].join('\n'))
  return r.ok ? EXIT.OK : EXIT.CHECK_FAILED
}
