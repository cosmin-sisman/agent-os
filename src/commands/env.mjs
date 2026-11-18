// `agent-os env`: what this project needs (agent-os.json → requires) against what the repository declares and this
// laptop has. Prints each problem with the command that fixes it. Never prints a secret value.

import { CliError, EXIT } from '../cli/errors.mjs'
import { ask } from '../cli/prompt.mjs'
import { acceptRequirements, proposeRequirements } from '../env/stack-requires.mjs'
import { loadConfig } from '../config/config.mjs'
import { checkEnvironment } from '../env/checks.mjs'
import { systemProbe } from '../env/probe.mjs'

export const usage = 'agent-os env [--fast | --ci]   ·   env propose [--accept <id>… | --accept-all] [--dry-run]   (requirements the stack suggests)'

export const options = {
  fast: { type: 'boolean', description: 'Only the checks that need no commands (under a second): repo side and variables' },
  ci: { type: 'boolean', description: 'Only the repository side, for CI (the laptop is not the runner)' },
  accept: { type: 'string', multiple: true, description: 'propose: add this proposal (mcp:<name> or cli:<name>) to agent-os.json' },
  'accept-all': { type: 'boolean', description: 'propose: add every proposal' },
}

const MARK = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' }

/**
 * The machine comes from `ctx.io.probe` in tests and from systemProbe otherwise.
 * @param {import('../cli/context.mjs').Context} ctx
 */
export async function run(ctx) {
  if (ctx.positionals[0] === 'propose') return propose(ctx)
  if (ctx.positionals[0]) throw new CliError(`unknown action "${ctx.positionals[0]}"`, { hint: `usage: ${usage}` })
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

/** Proposals from the stack; nothing is added unless accepted by id, with --accept-all, or answered yes. */
async function propose(ctx) {
  const { merged } = loadConfig(ctx.cwd)
  const proposals = proposeRequirements(ctx.cwd, merged)
  const v = ctx.values
  for (const id of v.accept ?? []) if (!proposals.some((p) => p.id === id)) throw new CliError(`no proposal "${id}"`, { hint: proposals.length ? `proposals: ${proposals.map((p) => p.id).join(', ')}` : 'the stack suggests nothing that is not required already' })
  let chosen = v['accept-all'] ? proposals : proposals.filter((p) => (v.accept ?? []).includes(p.id))
  if (!chosen.length && !v.accept && !v['accept-all'] && ctx.io.ask && !ctx.dryRun) {
    chosen = []
    for (const p of proposals) if (await ask(ctx.io, { text: `Require ${p.id}? ${p.why}`, kind: 'yesno', default: false })) chosen.push(p)
  }
  const added = acceptRequirements(ctx.cwd, chosen, { dryRun: ctx.dryRun })
  const lines = proposals.length ? proposals.map((p) => `${added.includes(p.id) ? (ctx.dryRun ? 'would add' : 'added   ') : 'proposed'}  ${p.id.padEnd(22)} ${p.why}`) : ['the stack suggests nothing that agent-os.json does not require already']
  if (proposals.length && !added.length) lines.push('', 'nothing was added: accept with agent-os env propose --accept <id> (or --accept-all), then run agent-os env')
  ctx.output({ proposals, added, dryRun: ctx.dryRun }, lines.join('\n'))
  return EXIT.OK
}
