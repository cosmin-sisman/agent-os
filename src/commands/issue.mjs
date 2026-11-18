// `agent-os issue`: the tracker operations skills need, without composing gh commands: create (with labels, milestone,
// assignees, parent, blockers and board status in one call), update, relate, block, assign, branch, status, and
// reads (get, children, blockers, progress). Every write supports --dry-run, and every command --json. Warnings (such
// as a board skipped for a missing scope) go to stderr, so the JSON on stdout is only the result.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { validateTicket, resolveLabels, findSimilar, relationshipPlan, applyActions } from '../tracker/ticket.mjs'
import { capabilitiesFor } from '../platform/probe.mjs'
import { EXIT } from '../cli/errors.mjs'

export const usage = [
  'agent-os issue new --title "<Area>: <problem>" --body-file <f> --label <type> --label <priority> --label <area> --milestone <m> [--assignee <u>…] [--parent <n>] [--blocked-by <n>…] [--blocks <n>…] [--extend <n> | --force-new]',
  'agent-os issue similar "<title>"   ·   comment <n> --body-file <f>',
  'agent-os issue get|children|blockers <n>',
  'agent-os issue create --title <t> [--body-file <f>] [--label <l>…] [--milestone <m>] [--assignee <u>…] [--parent <n>] [--blocked-by <n>…] [--status <s>]',
  'agent-os issue update <n> [--title <t>] [--body-file <f>] [--state open|closed] [--milestone <m>] [--label <l>…] [--remove-label <l>…]',
  'agent-os issue relate <child> --parent <n>   ·   block <n> --blocked-by <m>…   ·   assign <n> <login>…',
  'agent-os issue branch <n> --name <branch> [--base <branch>]   ·   status <n> <value> [--field <name>]   ·   progress [--milestone <m>]',
].join('\n       ')

export const options = {
  title: { type: 'string', description: 'Issue title' },
  'body-file': { type: 'string', description: 'Read the issue body from this file' },
  label: { type: 'string', multiple: true, description: 'A label (repeat for several)' },
  'remove-label': { type: 'string', multiple: true, description: 'A label to remove (repeat for several)' },
  milestone: { type: 'string', description: 'Milestone title' },
  assignee: { type: 'string', multiple: true, description: 'An assignee login (repeat for several)' },
  parent: { type: 'string', description: 'Parent issue number (sub-issue relationship)' },
  'blocked-by': { type: 'string', multiple: true, description: 'An issue number that blocks this one (repeat for several)' },
  status: { type: 'string', description: 'Board status to set (Todo, In Progress, Done, …)' },
  state: { type: 'string', description: 'open or closed' },
  name: { type: 'string', description: 'Branch name' },
  base: { type: 'string', description: 'Base branch' },
  field: { type: 'string', description: 'Board field to set (default Status)' },
  blocks: { type: 'string', multiple: true, description: 'new: an issue number this one blocks (repeat for several)' },
  extend: { type: 'string', description: 'new: add this as a comment on an existing issue instead of creating one' },
  'force-new': { type: 'boolean', description: 'new: create it even when similar issues exist' },
}

const num = (raw, what) => {
  const n = Number(String(raw ?? '').replace(/^#/, ''))
  if (!Number.isInteger(n) || n < 1) throw new CliError(`${what} must be an issue number, got "${raw ?? ''}"`, { hint: `usage: ${usage}` })
  return n
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action, ...args] = ctx.positionals
  if (action === 'new') return newIssue(ctx)
  const v = ctx.values
  const tracker = ctx.io.tracker ?? createTracker(loadConfig(ctx.cwd).merged, { gh: ctx.io.gh })
  const dry = { dryRun: ctx.dryRun }
  const body = () => (v['body-file'] ? readFileSync(resolve(ctx.cwd, v['body-file']), 'utf8') : undefined)
  let result
  switch (action) {
    case 'get': result = tracker.get(num(args[0], 'the issue')); break
    case 'children': result = tracker.children(num(args[0], 'the issue')); break
    case 'blockers': result = tracker.blockers(num(args[0], 'the issue')); break
    case 'progress': result = tracker.progress(v.milestone); break
    case 'similar': result = findSimilar(tracker, args.join(' ') || v.title || ''); break
    case 'comment': {
      if (!v['body-file']) throw new CliError('missing --body-file', { hint: `usage: ${usage}` })
      result = tracker.comment(num(args[0], 'the issue'), body(), dry)
      break
    }
    case 'create':
      result = tracker.create({ title: v.title, body: body(), labels: v.label, milestone: v.milestone, assignees: v.assignee, parent: v.parent && num(v.parent, '--parent'), blockedBy: (v['blocked-by'] ?? []).map((b) => num(b, '--blocked-by')), status: v.status }, dry)
      break
    case 'update': {
      if (v.state && !['open', 'closed'].includes(v.state)) throw new CliError(`--state must be open or closed, got "${v.state}"`)
      result = tracker.update(num(args[0], 'the issue'), { title: v.title, body: body(), state: v.state, milestone: v.milestone, addLabels: v.label ?? [], removeLabels: v['remove-label'] ?? [] }, dry)
      break
    }
    case 'relate': result = tracker.setParent(num(args[0], 'the child issue'), num(v.parent, '--parent'), dry); break
    case 'block': {
      const n = num(args[0], 'the issue')
      if (!v['blocked-by']?.length) throw new CliError('missing --blocked-by', { hint: `usage: ${usage}` })
      result = v['blocked-by'].map((b) => tracker.addBlocker(n, num(b, '--blocked-by'), dry))
      break
    }
    case 'assign': {
      if (args.length < 2) throw new CliError('assign needs an issue and at least one login', { hint: `usage: ${usage}` })
      result = tracker.assign(num(args[0], 'the issue'), args.slice(1), dry)
      break
    }
    case 'branch': {
      if (!v.name) throw new CliError('missing --name', { hint: `usage: ${usage}` })
      result = tracker.linkBranch(num(args[0], 'the issue'), { branch: v.name, base: v.base }, dry)
      break
    }
    case 'status': {
      if (!args[1]) throw new CliError('missing the status value', { hint: `usage: ${usage}` })
      result = tracker.setStatus(num(args[0], 'the issue'), args.slice(1).join(' '), { field: v.field ?? 'Status', ...dry })
      break
    }
    default: throw new CliError(action ? `unknown action "${action}"` : 'missing action', { hint: `usage: ${usage}` })
  }
  for (const w of tracker.warnings ?? []) ctx.io.stderr(`agent-os: warning: ${w}\n`)
  ctx.output(result, JSON.stringify(result, null, 2))
}

/** `issue new`: a complete issue, after a duplicate search; relationships go through the platform capabilities. */
async function newIssue(ctx) {
  const v = ctx.values
  const { merged } = loadConfig(ctx.cwd)
  const tracker = ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh })
  const spec = {
    title: v.title, body: v['body-file'] ? readFileSync(resolve(ctx.cwd, v['body-file']), 'utf8') : '',
    labels: resolveLabels(v.label ?? [], merged), milestone: v.milestone, status: v.status,
  }
  if (v.extend) {
    const n = num(v.extend, '--extend')
    const result = tracker.comment(n, spec.body, { dryRun: ctx.dryRun })
    return ctx.output({ extended: n, ...result }, `${ctx.dryRun ? 'would add' : 'added'} the request as a comment on #${n} instead of a new issue`)
  }
  const problems = validateTicket(spec, merged)
  if (problems.length) {
    ctx.output({ created: false, problems }, `not created; fix:\n  - ${problems.join('\n  - ')}`)
    return EXIT.CHECK_FAILED
  }
  if (!v['force-new']) {
    const similar = findSimilar(tracker, spec.title)
    if (similar.length) {
      const lines = similar.map((i) => `  #${i.number} (${i.state}, ${Math.round(i.score * 100)}% alike): ${i.title}`)
      ctx.output({ created: false, similar }, [`not created: these look like the same request:`, ...lines, `extend one instead (agent-os issue new … --extend ${similar[0].number}), or create it anyway with --force-new`].join('\n'))
      return EXIT.CHECK_FAILED
    }
  }
  const caps = (await capabilitiesFor(merged, { cwd: ctx.cwd, gh: ctx.io.gh })).capabilities
  const created = tracker.create(spec, { dryRun: ctx.dryRun })
  const number = ctx.dryRun ? '<new>' : created.number
  const actions = relationshipPlan(caps, {
    number, parent: v.parent && num(v.parent, '--parent'),
    blockedBy: (v['blocked-by'] ?? []).map((b) => num(b, '--blocked-by')), blocks: (v.blocks ?? []).map((b) => num(b, '--blocks')), assignees: v.assignee ?? [],
  })
  const related = applyActions(tracker, actions, { dryRun: ctx.dryRun })
  for (const w of tracker.warnings ?? []) ctx.io.stderr(`agent-os: warning: ${w}\n`)
  const result = { created: !ctx.dryRun, issue: created, relationships: actions, related }
  ctx.output(result, ctx.dryRun ? `would create "${spec.title}" with ${spec.labels.join(', ')} in ${spec.milestone}, then: ${actions.map((a) => `${a.do} ${a.type ?? a.label ?? ''}`.trim()).join(', ') || 'nothing else'}` : `created #${created.number}: ${created.url}`)
  return EXIT.OK
}
