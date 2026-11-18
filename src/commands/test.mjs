// `agent-os test`: plan (scenarios into the issue), pr (the gate's results into the change request), local (the
// suites the diff needs, or --all), gaps (changed logic without a test). The `testing` slot can replace the skill.

import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { languageFor } from '../i18n/i18n.mjs'
import { changedFiles, readResult, resultsTable, runGate } from '../gate/gate.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { planScenarios, testGaps, withResults, withScenarios } from '../testing/test.mjs'
import { systemGit } from '../workflow/start.mjs'

export const usage = 'agent-os test plan <issue> [--write] [--dry-run] | pr [<n>] [--dry-run] | local [--all] [--suite <name>…] | gaps'

export const options = {
  write: { type: 'boolean', description: 'plan: add the proposed scenarios to the issue' },
  all: { type: 'boolean', description: 'local: every suite' },
  suite: { type: 'string', multiple: true, description: 'local: only this suite (repeat)' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action, arg] = ctx.positionals
  const { merged } = loadConfig(ctx.cwd)
  const git = ctx.io.git ?? systemGit(ctx.cwd)
  const tracker = () => ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })
  const num = (x) => { const n = Number(String(x ?? '').replace(/^[#!]/, '')); if (!Number.isInteger(n) || n < 1) throw new CliError('which number?', { hint: `usage: ${usage}` }); return n }

  if (action === 'plan') {
    const n = num(arg)
    const t = tracker()
    const issue = t.get(n)
    const lang = languageFor(merged, 'issues')
    const p = planScenarios(issue, { lang })
    const write = ctx.values.write && !ctx.dryRun && p.proposed.length
    if (write) t.update(n, { body: withScenarios(issue.body, p.proposed, { lang }) })
    ctx.output({ number: n, ...p, written: Boolean(write) }, [
      `#${n}: ${p.existing.length} scenario(s) already, ${p.proposed.length} to add${write ? ' (added)' : ctx.values.write ? '' : ' (add them with --write, after filling in the …)'}`,
      ...p.proposed.map((s) => `  - [ ] ${s}`),
    ].join('\n'))
    return EXIT.OK
  }
  if (action === 'local') {
    const r = runGate({ config: merged, git, cwd: ctx.cwd, exec: ctx.io.exec }, { all: ctx.values.all, only: ctx.values.suite ?? [] })
    ctx.output(r, `${resultsTable(r)}\n\n${r.ok ? 'passed' : 'failed'}`)
    return r.ok ? EXIT.OK : EXIT.CHECK_FAILED
  }
  if (action === 'gaps') {
    const gaps = testGaps(changedFiles(git, merged.branches.integration), { exclude: merged.testing?.exclude ?? [], map: merged.testing?.map ?? {} })
    ctx.output({ gaps }, gaps.length ? `${gaps.length} changed file(s) with no changed test:\n${gaps.map((g) => `  ${g}`).join('\n')}\nAdd the tests the issue's scenarios describe, or say in the change request why none is needed.` : 'every changed source file has a changed test')
    return EXIT.OK
  }
  if (action === 'pr') {
    const result = readResult(ctx.cwd)
    if (!result) throw new CliError('the gate has not run on this branch', { hint: 'agent-os gate (or agent-os test local)' })
    const table = resultsTable(result)
    const t = tracker()
    const n = arg ? num(arg) : t.pullRequestFor(git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim())?.number
    if (!n) throw new CliError('this branch has no open change request', { hint: 'agent-os pr create …' })
    const body = withResults(t.pullRequestStatus(n).body, table)
    if (!ctx.dryRun) t.updatePullRequest(n, { body })
    ctx.output({ number: n, table, dryRun: ctx.dryRun }, `${ctx.dryRun ? 'would write' : 'wrote'} the results into #${n}:\n${table}`)
    return EXIT.OK
  }
  throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
}
