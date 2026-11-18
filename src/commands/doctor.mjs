// `agent-os doctor`: check the agent system, the repository and the platform hygiene; --fix for mechanical repairs.
// Exit 1 when a check fails.

import { planPlatformSetup } from '../platform/setup.mjs'
import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { runDoctor, report } from '../doctor/doctor.mjs'
import { CHECKS } from '../doctor/checks.mjs'
import { capabilitiesFor } from '../platform/probe.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { runningVersion } from '../version/pin.mjs'

export const usage = 'agent-os doctor [--offline | --ci] [--fix] [--check <id>…]'

export const options = {
  offline: { type: 'boolean', description: 'Local checks only: no platform calls' },
  ci: { type: 'boolean', description: 'What the CI loop check runs: local, deterministic checks' },
  fix: { type: 'boolean', description: 'Apply the mechanical fixes, then check again' },
  check: { type: 'string', multiple: true, description: `Run only this check (repeat): ${CHECKS.map((c) => c.id).join(', ')}` },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const only = ctx.values.check ?? []
  const unknown = only.filter((id) => !CHECKS.some((c) => c.id === id))
  if (unknown.length) throw new CliError(`unknown check(s): ${unknown.join(', ')}`, { hint: CHECKS.map((c) => c.id).join(', ') })
  let loaded
  try { loaded = loadConfig(ctx.cwd) } catch (err) {
    ctx.output({ score: 0, summary: { ok: 0, warn: 0, fail: 1 }, checks: [{ id: 'config', findings: [{ level: 'fail', message: err.message, fix: err.hint }] }] }, `FAIL  [config] ${err.message}\n      fix: ${err.hint}`)
    return EXIT.CHECK_FAILED
  }
  const config = loaded.merged
  const local = ctx.values.offline || ctx.values.ci || !config.platform?.project
  let tracker = null
  let caps = null
  let me = null
  if (!local) {
    tracker = ctx.io.tracker ?? createTracker(config, { gh: ctx.io.gh, glab: ctx.io.glab })
    caps = (await capabilitiesFor(config, { cwd: ctx.cwd, gh: ctx.io.gh, glab: ctx.io.glab, refresh: true })).capabilities
    try { me = tracker.whoami() } catch { me = null }
  }
  const platformPlan = () => planPlatformSetup(config, { gh: ctx.io.gh, glab: ctx.io.glab, only: ['ruleset'] })
  const r = runDoctor({ cwd: ctx.cwd, config, tracker, caps, me, platformPlan, running: ctx.io.running ?? runningVersion() }, { offline: ctx.values.offline || !config.platform?.project, ci: ctx.values.ci, fix: ctx.values.fix && !ctx.dryRun, only })
  if (!loaded.initialized) r.checks.unshift({ id: 'config', findings: [{ level: 'warn', message: 'there is no agent-os.json: this repository is not set up yet', fix: 'agent-os init' }] })
  ctx.output(r, report(r))
  return r.summary.fail ? EXIT.CHECK_FAILED : EXIT.OK
}
