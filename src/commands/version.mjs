// `agent-os version`: prints the running version, and with --check compares it with the project's pin (exit 1 on a
// mismatch, with the fix).

import { EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { runningVersion, versionStatus } from '../version/pin.mjs'

export const usage = 'agent-os version [--check] [--json]'

export const options = {
  check: { type: 'boolean', description: "Compare with the project's pinned version" },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export function run(ctx) {
  const running = runningVersion()
  if (!ctx.values.check) return ctx.output({ name: '@cosmin-sisman/agent-os', version: running }, running)
  const status = versionStatus(loadConfig(ctx.cwd).merged, { cwd: ctx.cwd, running })
  ctx.output(status, status.ok ? `agent-os ${running} matches the pin` : status.problems.map((p) => `${p.message}\n  fix: ${p.fix}`).join('\n'))
  return status.ok ? EXIT.OK : EXIT.CHECK_FAILED
}
