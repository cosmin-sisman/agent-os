// `agent-os discover`: `plan` infers the conventions an active repository follows (commit style, branch prefixes,
// merge strategy, areas, decisions from change requests), each proposal with its evidence, and saves the plan in the
// cache; `apply --accept <id>…` writes only the accepted proposals: config keys into agent-os.json, decisions into
// the journal, the area map draft into the cache for the /discover skill to place in AGENTS.md.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError, EXIT } from '../cli/errors.mjs'
import { TEAM_FILE, loadConfig, saveJson, setPath, validate } from '../config/config.mjs'
import { addEntry } from '../journal/journal.mjs'
import { languageFor } from '../i18n/i18n.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { systemGit } from '../workflow/start.mjs'
import { areaMapDraft, discoverPlan, readPlan, savePlan } from '../discover/discover.mjs'

export const usage = 'agent-os discover plan [--commits <n>]   ·   apply --accept <id>… [--dry-run]'

export const options = {
  commits: { type: 'string', description: 'plan: how many recent commits to read (default 500)' },
  accept: { type: 'string', multiple: true, description: 'apply: a proposal id the person accepted (repeat)' },
}

export const AREA_MAP_FILE = '.agent-os/cache/discover-area-map.md'

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action] = ctx.positionals
  const git = ctx.io.git ?? systemGit(ctx.cwd)
  if (action === 'plan') {
    const { merged } = loadConfig(ctx.cwd)
    const tracker = ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })
    const n = ctx.values.commits ? Number(ctx.values.commits) : 500
    if (!Number.isInteger(n) || n < 1) throw new CliError(`--commits takes a positive number, got "${ctx.values.commits}"`)
    const plan = discoverPlan({ git, tracker, commits: n })
    if (!ctx.dryRun) savePlan(ctx.cwd, plan)
    ctx.output(plan, [
      `read ${plan.commits} commit(s), ${plan.changeRequests} change request(s), ${plan.branches} branch name(s): ${plan.proposals.length} proposal(s)`,
      ...plan.proposals.flatMap((p) => [``, `[${p.id}] ${p.rule}${p.key ? `\n  ${p.key} = ${JSON.stringify(p.value)}` : ''}`, ...p.evidence.map((e) => `  evidence: ${e}`)]),
      '', 'review each with the person; nothing is written until: agent-os discover apply --accept <id>…',
    ].join('\n'))
    return EXIT.OK
  }
  if (action === 'apply') {
    const accept = ctx.values.accept ?? []
    if (!accept.length) throw new CliError('which proposals did the person accept?', { hint: 'agent-os discover apply --accept branch-prefixes --accept decision:42' })
    const plan = readPlan(ctx.cwd)
    const chosen = accept.map((id) => plan.proposals.find((p) => p.id === id) ?? (() => { throw new CliError(`no proposal "${id}" in the plan`, { hint: plan.proposals.map((p) => p.id).join(', ') }) })())
    const { team, merged } = loadConfig(ctx.cwd)
    let config = structuredClone(team ?? {})
    const done = []
    for (const p of chosen) {
      if (p.kind === 'config') { config = setPath(config, p.key, p.value); done.push({ id: p.id, wrote: `${TEAM_FILE}: ${p.key}` }) } else if (p.kind === 'decision') {
        const e = addEntry(ctx.cwd, { type: 'decision', title: p.entry.title, body: p.entry.body, refs: p.entry.refs, areas: p.entry.areas ?? ['history'], author: p.entry.author ?? 'unknown', at: ctx.io.now ?? new Date(), lang: languageFor(merged, 'journal'), dryRun: ctx.dryRun })
        if (e.problems?.length) throw new CliError(`the decision entry for ${p.id} is invalid: ${e.problems.join('; ')}`)
        done.push({ id: p.id, wrote: e.path })
      } else if (p.kind === 'area-map') {
        if (!ctx.dryRun) writeFileSync(join(ctx.cwd, AREA_MAP_FILE), `${areaMapDraft(p.rows)}\n`)
        done.push({ id: p.id, wrote: AREA_MAP_FILE })
      } else done.push({ id: p.id, wrote: null })
    }
    if (chosen.some((p) => p.kind === 'config')) {
      const problems = validate(config, { personal: false, file: TEAM_FILE })
      if (problems.length) throw new CliError(`the accepted proposals make an invalid ${TEAM_FILE}:\n  - ${problems.join('\n  - ')}`)
      if (!ctx.dryRun) saveJson(ctx.cwd, TEAM_FILE, config)
    }
    ctx.output({ dryRun: ctx.dryRun, done }, done.map((d) => `${ctx.dryRun ? 'would apply' : 'applied'} ${d.id}${d.wrote ? ` → ${d.wrote}` : ' (noted, nothing to write)'}`).join('\n'))
    return EXIT.OK
  }
  throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
}
