// `agent-os issue`: the tracker operations skills need, without composing gh commands: create (with labels, milestone,
// assignees, parent, blockers and board status in one call), update, relate, block, assign, branch, status, and
// reads (get, children, blockers, progress). Every write supports --dry-run, and every command --json. Warnings (such
// as a board skipped for a missing scope) go to stderr, so the JSON on stdout is only the result.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { createTracker } from '../tracker/tracker.mjs'

export const usage = [
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
}

const num = (raw, what) => {
  const n = Number(String(raw ?? '').replace(/^#/, ''))
  if (!Number.isInteger(n) || n < 1) throw new CliError(`${what} must be an issue number, got "${raw ?? ''}"`, { hint: `usage: ${usage}` })
  return n
}

/** @param {import('../cli/context.mjs').Context} ctx */
export function run(ctx) {
  const [action, ...args] = ctx.positionals
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
