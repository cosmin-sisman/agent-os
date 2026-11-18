// `agent-os skill`: register skills that agent-os does not install (local, external, plugin, builtin) and check the
// registry. Adding, updating and removing vendored skills comes with #39.

import { CliError, EXIT } from '../cli/errors.mjs'
import { ORIGINS, readRegistry, registerSkill } from '../registry/registry.mjs'

export const usage = 'agent-os skill register <name> --origin local|external|plugin|builtin [--source <host:owner/repo@ref>] [--version <v>] [--license <id>] [--provides <slot>…] [--force] [--dry-run] | check'

export const options = {
  origin: { type: 'string', description: `register: ${ORIGINS.filter((o) => o !== 'core').join(', ')}` },
  source: { type: 'string', description: 'register: where it comes from; external skills pin a commit or tag (github:owner/repo@sha)' },
  version: { type: 'string', description: 'register: the skill version' },
  license: { type: 'string', description: 'register: its license id (MIT, Apache-2.0, …)' },
  provides: { type: 'string', multiple: true, description: 'register: a capability slot it fills (repeat), e.g. review' },
  force: { type: 'boolean', description: 'register: replace an existing entry' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action, name] = ctx.positionals
  if (action === 'register') {
    if (!name) throw new CliError('which skill?', { hint: `usage: ${usage}` })
    const v = ctx.values
    const r = registerSkill(ctx.cwd, { name, origin: v.origin, source: v.source, version: v.version, license: v.license, provides: v.provides }, { force: v.force, dryRun: ctx.dryRun })
    ctx.output(r, `${r.dryRun ? 'would write' : 'wrote'} ${r.path}`)
    return EXIT.OK
  }
  if (action === 'check') {
    const entries = readRegistry(ctx.cwd)
    const problems = entries.filter((e) => e.problems.length)
    ctx.output({ entries: entries.length, problems }, problems.length ? problems.map((p) => `  ${p.path}: ${p.problems.join('; ')}`).join('\n') : `registry: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, all valid (doctor also checks folders against entries)`)
    return problems.length ? EXIT.CHECK_FAILED : EXIT.OK
  }
  throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
}
