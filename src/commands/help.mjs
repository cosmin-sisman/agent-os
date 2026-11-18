// `agent-os help [command]`: lists every command with its lifecycle state, or explains one command.

import { COMMANDS, findCommand, suggestCommand } from '../cli/registry.mjs'
import { GLOBAL_OPTIONS, ISSUES_URL } from '../cli/options.mjs'
import { CliError } from '../cli/errors.mjs'

export const usage = 'agent-os help [command]'

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const name = ctx.positionals[0]
  if (!name) return overview(ctx)
  const entry = findCommand(name)
  if (!entry) {
    const near = suggestCommand(name)
    throw new CliError(`unknown command "${name}"`, { hint: near ? `did you mean "${near}"?` : 'run "agent-os --help" to see every command' })
  }
  const mod = entry.load ? await entry.load() : null
  const options = { ...(mod?.options ?? {}), ...GLOBAL_OPTIONS }
  const lines = [
    `agent-os ${entry.name}: ${entry.summary}`,
    '',
    `Usage: ${mod?.usage ?? `agent-os ${entry.name}`}`,
    `Status: ${entry.status}${entry.status === 'planned' ? ` (follow #${entry.issue}: ${ISSUES_URL}/${entry.issue})` : ''}`,
    '',
    'Options:',
    ...formatOptions(options),
  ]
  ctx.output({ name: entry.name, summary: entry.summary, status: entry.status, issue: entry.issue ?? null, usage: mod?.usage ?? null, options: Object.keys(options) }, lines.join('\n'))
}

function overview(ctx) {
  const width = Math.max(...COMMANDS.map((c) => c.name.length))
  const row = (c) => `  ${c.name.padEnd(width)}  ${c.summary}${c.status === 'planned' ? `  (planned, #${c.issue})` : ''}`
  const ready = COMMANDS.filter((c) => c.load)
  const planned = COMMANDS.filter((c) => !c.load)
  const lines = [
    'agent-os: the operating agreement for people, coding agents and their code platform',
    '',
    'Usage: agent-os <command> [options]',
    '',
    'Commands:',
    ...ready.map(row),
    '',
    'Planned (they exit with code 2 until their issue ships):',
    ...planned.map(row),
    '',
    'Global options:',
    ...formatOptions(GLOBAL_OPTIONS),
    '',
    'Exit codes: 0 ok, 1 a check failed, 2 could not run.',
    'Run "agent-os help <command>" for details.',
  ]
  ctx.output({ commands: COMMANDS.map(({ name, summary, status, issue }) => ({ name, summary, status, issue: issue ?? null })) }, lines.join('\n'))
}

function formatOptions(options) {
  const flag = ([name, o]) => `${o.short ? `-${o.short}, ` : '    '}--${name}${o.type === 'string' ? ' <value>' : ''}`
  const entries = Object.entries(options)
  const width = Math.max(...entries.map((e) => flag(e).length))
  return entries.map((e) => `  ${flag(e).padEnd(width)}  ${e[1].description ?? ''}`)
}
