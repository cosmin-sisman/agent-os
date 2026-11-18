// `agent-os env`: what this project needs (agent-os.json → requires) against what the repository declares and this
// laptop has. Prints each problem with the command that fixes it. Never prints a secret value.

import { EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { checkEnvironment } from '../env/checks.mjs'
import { systemProbe } from '../env/probe.mjs'

export const usage = 'agent-os env [--fast | --ci]'

export const options = {
  fast: { type: 'boolean', description: 'Only the checks that need no commands (under a second): repo side and variables' },
  ci: { type: 'boolean', description: 'Only the repository side, for CI (the laptop is not the runner)' },
}

const MARK = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' }

/**
 * The machine comes from `ctx.io.probe` in tests and from systemProbe otherwise.
 * @param {import('../cli/context.mjs').Context} ctx
 */
export function run(ctx) {
  const probe = ctx.io.probe ?? systemProbe(ctx.io.env)
  const { merged } = loadConfig(ctx.cwd)
  const mode = ctx.values.ci ? 'ci' : ctx.values.fast ? 'fast' : 'full'
  const result = checkEnvironment(merged, { cwd: ctx.cwd, probe, mode })
  const lines = result.findings.map((f) => `${MARK[f.level]}  ${f.side.padEnd(6)}  ${f.message}${f.fix ? `\n                fix: ${f.fix}` : ''}`)
  const { ok, warn, fail } = result.summary
  const nothing = !result.findings.length ? ['nothing to check: agent-os.json has no requires yet'] : []
  ctx.output(result, [...nothing, ...lines, '', `${mode} check: ${fail} failing, ${warn} warning(s), ${ok} ok`].join('\n').replace(/^\n/, ''))
  return fail ? EXIT.CHECK_FAILED : EXIT.OK
}
