// `agent-os hook <Event>`: the single entry point Claude Code calls from .claude/settings.json. It reads the event
// payload from stdin, runs the handlers and prints the hook response. It always exits 0: a hook must never break a
// session because of an agent-os problem. `--print-settings` prints the hooks block for settings.json.

import { EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { runEvent, settingsHooks, EVENTS } from '../hooks/runner.mjs'
import { hookCommand } from '../version/pin.mjs'

export const usage = `agent-os hook <${EVENTS.join('|')}>   (reads the event JSON on stdin)\n       agent-os hook --print-settings`

export const options = {
  'print-settings': { type: 'boolean', description: 'Print the hooks block for .claude/settings.json' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  if (ctx.values['print-settings']) {
    const hooks = settingsHooks(hookCommand(loadConfig(ctx.cwd).merged, { cwd: ctx.cwd }))
    return ctx.output({ hooks }, JSON.stringify({ hooks }, null, 2))
  }
  const event = ctx.positionals[0]
  let input = {}
  try {
    const raw = ctx.io.readStdin ? await ctx.io.readStdin() : ''
    input = raw.trim() ? JSON.parse(raw) : {}
  } catch {
    ctx.debug('hook: stdin is not JSON; running with an empty payload')
  }
  let config
  try {
    config = loadConfig(input.cwd ?? ctx.cwd).merged
  } catch (err) {
    ctx.io.stdout(`${JSON.stringify({ systemMessage: `agent-os: hooks skipped, the configuration is invalid: ${err.message}` })}\n`)
    return EXIT.OK
  }
  const response = await runEvent(event, input, { config, cwd: input.cwd ?? ctx.cwd, env: ctx.io.env })
  if (response) ctx.io.stdout(`${JSON.stringify(response)}\n`)
  return EXIT.OK
}
