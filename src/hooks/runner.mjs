// The hooks runner: Claude Code calls `agent-os hook <Event>` with a JSON payload on stdin. The runner runs every
// handler registered for the event, each isolated and with a timeout, and answers in the hook JSON format.
// Handlers never block a session by failing: a crash or timeout is reported once per session and skipped.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkCommand, rulesFor } from './guards.mjs'
import { checkEnvironment } from '../env/checks.mjs'
import { systemProbe } from '../env/probe.mjs'
import { versionStatus } from '../version/pin.mjs'

export const EVENTS = ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']

/**
 * @typedef {object} HandlerResult
 * @property {'deny'} [decision] PreToolUse only: refuse the tool call
 * @property {string} [message] why, or a warning for the user
 * @property {string} [context] SessionStart only: text added to the session's context
 */

/**
 * @typedef {object} Handler
 * @property {string} name
 * @property {string[]} events
 * @property {'guard' | 'reminder' | 'context'} kind guards may refuse; the others can only warn or add context
 * @property {number} [timeoutMs]
 * @property {(input: object, env: { config: object, cwd: string, env: object }) => Promise<HandlerResult | void> | HandlerResult | void} run
 */

/** @type {Handler[]} */
export const CORE_HANDLERS = [
  {
    name: 'guards',
    events: ['PreToolUse'],
    kind: 'guard',
    timeoutMs: 3000,
    run(input, { config, env }) {
      const command = input.tool_input?.command
      if (typeof command !== 'string' || !/^(Bash|PowerShell)$/.test(input.tool_name ?? '')) return
      const broken = checkCommand(command, { rules: rulesFor(config), env, minFreeMb: config.machine?.minFreeMb ?? 0 })
      if (broken.length) return { decision: 'deny', message: broken.map((b) => `agent-os guard "${b.id}": ${b.message}`).join('\n') }
    },
  },
  {
    name: 'version',
    events: ['SessionStart'],
    kind: 'reminder',
    timeoutMs: 1000,
    run(input, { config, cwd }) {
      const status = versionStatus(config, { cwd })
      if (!status.ok) return { message: `agent-os version: ${status.problems.map((p) => `${p.message} (fix: ${p.fix})`).join('; ')}` }
    },
  },
  {
    name: 'env',
    events: ['SessionStart'],
    kind: 'reminder',
    timeoutMs: 1000,
    run(input, { config, cwd, env }) {
      const { findings } = checkEnvironment(config, { cwd, probe: systemProbe(env), mode: 'fast' })
      const problems = findings.filter((f) => f.level !== 'ok')
      if (problems.length) return { message: `agent-os env: ${problems.map((f) => f.message).join('; ')}. Run "agent-os env" for the fixes.` }
    },
  },
]

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)
  Promise.resolve(promise).then((v) => { clearTimeout(timer); resolve(v) }, (e) => { clearTimeout(timer); reject(e) })
})

/** Adoption mode: until the configured date, guards warn instead of refusing. */
export function inAdoption(config, now = new Date()) {
  const until = config.adoption?.warnOnlyUntil
  return Boolean(until) && now.toISOString().slice(0, 10) < until
}

/** Remembers which handler failures were already reported in a session, so each is reported once. */
function failureLog(cwd) {
  const file = join(cwd, '.agent-os', 'cache', 'hook-failures.json')
  let data = {}
  try { data = JSON.parse(readFileSync(file, 'utf8')) } catch {}
  return {
    firstTime(session, handler) {
      const key = `${session}:${handler}`
      if (data[key]) return false
      data[key] = new Date().toISOString()
      try {
        if (!existsSync(join(cwd, '.agent-os', 'cache'))) mkdirSync(join(cwd, '.agent-os', 'cache'), { recursive: true })
        writeFileSync(file, JSON.stringify(data))
      } catch {}
      return true
    },
  }
}

/**
 * Runs the handlers for one event and returns the hook response (or null when there is nothing to say).
 * @param {string} event
 * @param {object} input the JSON Claude Code sent on stdin
 * @param {{ config: object, cwd: string, env?: object, handlers?: Handler[], now?: Date }} options
 */
export async function runEvent(event, input, { config, cwd, env = {}, handlers = CORE_HANDLERS, now = new Date() }) {
  if (!EVENTS.includes(event)) return null
  const adoption = inAdoption(config, now)
  const log = failureLog(cwd)
  const denials = []
  const warnings = []
  const contexts = []
  for (const h of handlers.filter((x) => x.events.includes(event))) {
    let result
    try {
      result = await withTimeout(h.run(input, { config, cwd, env }), h.timeoutMs ?? 5000)
    } catch (err) {
      if (log.firstTime(input.session_id ?? 'no-session', h.name)) warnings.push(`agent-os: the "${h.name}" hook failed and was skipped (${err?.message ?? err}); it will not be reported again this session`)
      continue
    }
    if (!result) continue
    if (result.context) contexts.push(result.context)
    if (result.decision === 'deny' && h.kind === 'guard' && event === 'PreToolUse') {
      if (adoption) warnings.push(`${result.message}\n(adoption mode until ${config.adoption.warnOnlyUntil}: allowed this time)`)
      else denials.push(result.message)
    } else if (result.message) warnings.push(result.message)
  }
  const out = {}
  if (denials.length) out.hookSpecificOutput = { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: denials.join('\n') }
  else if (contexts.length && event === 'SessionStart') out.hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext: contexts.join('\n\n') }
  if (warnings.length) out.systemMessage = warnings.join('\n')
  return Object.keys(out).length ? out : null
}

/**
 * The hooks block for .claude/settings.json: one entry per event, each calling the runner with no shell syntax, so
 * the same command works whether Claude Code runs it through bash, zsh or PowerShell.
 * @param {string} command how to call agent-os, pinned (hookCommand in src/version/pin.mjs)
 */
export function settingsHooks(command) {
  if (!command) throw new Error('settingsHooks needs the pinned command (hookCommand in src/version/pin.mjs)')
  const entry = (event, extra = {}) => [{ ...extra, hooks: [{ type: 'command', command: `${command} hook ${event}`, timeout: event === 'Stop' ? 30 : 10 }] }]
  return {
    SessionStart: entry('SessionStart'),
    PreToolUse: entry('PreToolUse', { matcher: 'Bash|PowerShell' }),
    PostToolUse: entry('PostToolUse', { matcher: 'Edit|Write|MultiEdit' }),
    Stop: entry('Stop'),
  }
}
