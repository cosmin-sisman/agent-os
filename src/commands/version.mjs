// `agent-os version`: prints the package version (also `agent-os --version`).

import { readFileSync } from 'node:fs'

export const usage = 'agent-os version [--json]'

/** @param {import('../cli/context.mjs').Context} ctx */
export function run(ctx) {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  ctx.output({ name: pkg.name, version: pkg.version }, pkg.version)
}
