// The CLI entry point: finds the command, parses its flags strictly, runs it with a Context, and turns
// every outcome into a stable exit code and either text or one JSON object. bin/agent-os.mjs calls run().

import { parseArgs } from 'node:util'
import { runNotices } from '../lifecycle/legacy.mjs'
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { EXIT, CliError } from './errors.mjs'
import { findCommand, suggestCommand } from './registry.mjs'
import { GLOBAL_OPTIONS, ISSUES_URL } from './options.mjs'
import { Context } from './context.mjs'
import { applyNetwork } from '../platform/network.mjs'
import { loadConfig } from '../config/config.mjs'

/**
 * Runs agent-os with the given arguments and returns the exit code. It never calls process.exit, so it can be tested.
 * @param {string[]} argv arguments after the executable and script
 * @param {import('./context.mjs').IO} io
 * @returns {Promise<number>}
 */
export async function run(argv, io) {
  const json = argv.includes('--json')
  let command = 'help'
  try {
    const plan = route(argv)
    // The bare `agent-os` on a terminal, in a folder agent-os has not set up yet, starts the install (#264).
    if (!argv.length && io.ask && !existsSync(join(resolve(io.cwd), 'agent-os.json'))) plan.command = 'install'
    command = plan.command
    const entry = findCommand(command)
    if (!entry) {
      const near = suggestCommand(command)
      throw new CliError(`unknown command "${command}"`, { hint: near ? `did you mean "agent-os ${near}"? Run "agent-os --help" for every command.` : 'run "agent-os --help" to see every command' })
    }
    if (!entry.load) {
      throw new CliError(`"${command}" is planned but not implemented yet`, { hint: `follow #${entry.issue}: ${ISSUES_URL}/${entry.issue}` })
    }
    const mod = await entry.load()
    const { values, positionals } = parseStrict(plan.args, { ...GLOBAL_OPTIONS, ...(mod.options ?? {}) }, command)
    const cwd = resolveCwd(io.cwd, values.cwd)
    const ctx = new Context({ command, values, positionals, cwd, io })
    // Self-managed networks: the private CA, the proxy and the internal registry reach every tool agent-os starts,
    // through this process's environment only. Names are logged, never values.
    if (io.env) { try { const applied = applyNetwork(loadConfig(cwd).merged, cwd, io.env); if (applied.length) ctx.debug(`network: set ${applied.join(', ')}`) } catch { /* an invalid config is reported by the command */ } }
    for (const note of runNotices(command, values)) io.stderr(`agent-os: note: ${note}\n`)
    ctx.debug(`command=${command} cwd=${cwd}${ctx.dryRun ? ' dry-run' : ''}`)
    const code = (await mod.run(ctx)) ?? EXIT.OK
    if (json) io.stdout(`${JSON.stringify({ ok: code === EXIT.OK, command, exitCode: code, result: ctx.result ?? null })}\n`)
    return code
  } catch (err) {
    const known = err instanceof CliError
    const code = known ? err.code : EXIT.CANNOT_RUN
    const message = known ? err.message : `unexpected error: ${err?.message ?? err}`
    const hint = known ? err.hint : 'please report it with "agent-os --verbose" output'
    if (json) {
      io.stdout(`${JSON.stringify({ ok: false, command, exitCode: code, error: { message, ...(hint ? { hint } : {}) } })}\n`)
    } else {
      io.stderr(`agent-os: error: ${message}\n${hint ? `  hint: ${hint}\n` : ''}`)
    }
    if (!known && argv.includes('--verbose') && err?.stack) io.stderr(`${err.stack}\n`)
    return code
  }
}

/**
 * Finds the command and the arguments that belong to it. `--help` and `--version` without a command
 * map to the help and version commands; `<command> --help` maps to `help <command>`.
 * @param {string[]} argv
 */
export function route(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: GLOBAL_OPTIONS, strict: false, allowPositionals: true })
  const name = positionals[0]
  const rest = name === undefined ? argv : withoutFirst(argv, name)
  if (name && values.help && name !== 'help') return { command: 'help', args: [name, ...rest.filter((a) => a !== '--help' && a !== '-h')] }
  if (!name) return { command: values.version && !values.help ? 'version' : 'help', args: rest.filter((a) => !['--help', '-h', '--version', '-v'].includes(a)) }
  return { command: name, args: rest }
}

function withoutFirst(list, item) {
  const i = list.indexOf(item)
  return [...list.slice(0, i), ...list.slice(i + 1)]
}

function parseStrict(args, options, command) {
  try {
    return parseArgs({ args, options, strict: true, allowPositionals: true })
  } catch (err) {
    const first = String(err.message).split(/\.\s/)[0].replace(/\.$/, '')
    throw new CliError(first.charAt(0).toLowerCase() + first.slice(1), { hint: `run "agent-os ${command} --help" for its options` })
  }
}

function resolveCwd(base, given) {
  const dir = resolve(base, given ?? '.')
  let ok = false
  try { ok = statSync(dir).isDirectory() } catch {}
  if (!ok) throw new CliError(`--cwd "${given}" is not a directory`, { hint: 'pass an existing directory, relative to where you run agent-os' })
  return dir
}
