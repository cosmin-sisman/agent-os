// `agent-os sbom`: a CycloneDX software bill of materials from the lockfiles, for the advisory watch and for anyone
// who asks what the project ships. Written to a file or printed; it reads lockfiles as text and runs nothing.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { EXIT } from '../cli/errors.mjs'
import { inventory, sbom } from '../security/packages.mjs'

export const usage = 'agent-os sbom [--out <file>] [--json]'

export const options = {
  out: { type: 'string', description: 'Write the SBOM to this file (default: print it)' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export function run(ctx) {
  let name = 'project'
  let version = '0.0.0'
  try { const pkg = JSON.parse(readFileSync(resolve(ctx.cwd, 'package.json'), 'utf8')); name = pkg.name ?? name; version = pkg.version ?? version } catch { /* no package.json */ }
  const packages = inventory(ctx.cwd)
  const doc = sbom(packages, { name, version, now: ctx.io.now ?? new Date() })
  const text = `${JSON.stringify(doc, null, 2)}\n`
  if (ctx.values.out && !ctx.dryRun) writeFileSync(resolve(ctx.cwd, ctx.values.out), text)
  ctx.output(doc, ctx.values.out ? `${ctx.dryRun ? 'would write' : 'wrote'} ${ctx.values.out}: ${packages.length} component(s)` : text.trimEnd())
  return EXIT.OK
}
