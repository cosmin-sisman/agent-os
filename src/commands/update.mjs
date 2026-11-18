// `agent-os update`: `--plan` shows what a new version changes (read-only); without flags the update runs on its own
// branch chore/agent-os-<version> and opens a change request. `--relock` and `--migrate` remain as maintenance steps.

import { readFileSync } from 'node:fs'
import { CliError, EXIT } from '../cli/errors.mjs'
import { relock } from '../managed/managed.mjs'
import { loadConfig } from '../config/config.mjs'
import { runMigrations } from '../migrations/runner.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { planMarkdown, planUpdate, runUpdate } from '../update/update.mjs'
import { systemGit } from '../workflow/start.mjs'
import { ghClient } from '../tracker/gh.mjs'

export const usage = 'agent-os update [--plan] [--channel latest|next] [--no-pr] [--dry-run]\n       agent-os update --relock | --migrate [--dry-run]'

export const options = {
  plan: { type: 'boolean', description: 'Show what the update changes, grouped, without changing anything' },
  channel: { type: 'string', description: 'latest (default) or next: try a pre-release without changing the pinned version' },
  'no-pr': { type: 'boolean', description: 'Do the update on its branch but do not push or open the change request' },
  relock: { type: 'boolean', description: 'Rebuild .agent-os/lock.json from .agent-os/base/' },
  migrate: { type: 'boolean', description: 'Run the migrations from the pinned version to the running one' },
}

const running = () => JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  if (ctx.values.migrate) return migrate(ctx)
  if (ctx.values.relock) {
    const keys = relock(ctx.cwd, { version: running() })
    ctx.output({ items: keys }, `rebuilt .agent-os/lock.json: ${keys.length} managed item(s)`)
    return EXIT.OK
  }
  const channel = ctx.values.channel ?? 'latest'
  if (!['latest', 'next'].includes(channel)) throw new CliError(`unknown channel "${channel}"`, { hint: 'latest or next' })
  const io = ctx.io
  if (ctx.values.plan || ctx.dryRun) {
    const plan = await planUpdate(ctx.cwd, { release: io.release, templatesRoot: io.templatesRoot, migrationsDir: io.migrationsDir, channel })
    ctx.output(plan, [planMarkdown(plan), ...(plan.problems.length ? ['', 'Before updating:', ...plan.problems.map((p) => `  - ${p}`)] : []), ...(plan.upToDate ? ['', 'Already up to date.'] : [])].join('\n'))
    return plan.problems.length ? EXIT.CHECK_FAILED : EXIT.OK
  }
  const { merged } = loadConfig(ctx.cwd)
  const open = !ctx.values['no-pr']
  let author = null
  try { author = ghClient(io.gh).rest('GET', 'user')?.login ?? null } catch { /* the journal entry falls back to agent-os */ }
  const r = await runUpdate(ctx.cwd, { git: io.git ?? systemGit(ctx.cwd), tracker: open ? () => io.tracker ?? createTracker(merged, { gh: io.gh, glab: io.glab }) : null, exec: io.exec, vocab: vocabularyFor(merged.platform?.type) },
    { release: io.release, templatesRoot: io.templatesRoot, migrationsDir: io.migrationsDir, channel, author, open, now: io.now })
  if (r.upToDate) { ctx.output(r, `already on agent-os ${r.plan.to}`); return EXIT.OK }
  if (!r.updated) { ctx.output(r, `not updated:\n${r.problems.map((p) => `  - ${p}`).join('\n')}`); return EXIT.CHECK_FAILED }
  ctx.output(r, [
    `updated to ${r.plan.to} on ${r.branch}: ${r.files.length} file(s), ${r.migrations.length} migration(s), ${r.conflicts.length} conflict(s), gate ${r.gate.ok ? 'passed' : 'failed'}`,
    ...r.conflicts.map((c) => `  conflict: ${c.rej}`),
    r.changeRequest ? `opened ${r.changeRequest.url}${r.conflicts.length || !r.gate.ok ? ' (draft)' : ''}` : `not pushed (--no-pr): review ${r.branch}, then push it and open the change request`,
  ].join('\n'))
  return r.conflicts.length || !r.gate.ok ? EXIT.CHECK_FAILED : EXIT.OK
}

async function migrate(ctx) {
  const from = loadConfig(ctx.cwd).merged.version
  if (!from) throw new CliError('agent-os.json does not pin a version, so there is no starting point', { hint: `pin the version the project was set up with: agent-os config set version <x.y.z>` })
  const results = await runMigrations(ctx.cwd, { from, to: running(), dryRun: ctx.dryRun })
  const lines = results.map((r) => `${ctx.dryRun ? 'would run' : 'ran'} ${r.version}: ${r.description}${r.changes.length ? `\n  ${r.changes.join('\n  ')}` : ' (nothing to change)'}`)
  ctx.output({ from, to: running(), dryRun: ctx.dryRun, migrations: results }, lines.length ? lines.join('\n') : `no migrations between ${from} and ${running()}`)
  return EXIT.OK
}
