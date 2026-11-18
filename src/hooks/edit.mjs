// The on-edit reminder (PostToolUse on Edit, Write and MultiEdit): the standards' mechanical checks on the file just
// edited, about what the edit added, each reminded once per session. It only adds context for the agent; it never
// blocks, and it reads one file, so it stays well inside its short timeout.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { linesOf, standardsFindings } from '../standards/checks.mjs'
import { languageFor } from '../i18n/i18n.mjs'

const SEEN = '.agent-os/cache/reminders.json'

/** The text an edit added, from the tool input of Edit, Write or MultiEdit. */
export const insertedText = (input) => [input.tool_input?.content, input.tool_input?.new_string, ...(input.tool_input?.edits ?? []).map((e) => e.new_string)].filter((x) => typeof x === 'string').join('\n')

/** The reminder text for one tool call, or null. */
export function editReminders(input, { config, cwd }) {
  if (!/^(Edit|Write|MultiEdit)$/.test(input.tool_name ?? '')) return null
  const path = input.tool_input?.file_path
  if (typeof path !== 'string') return null
  const abs = isAbsolute(path) ? path : join(cwd, path)
  const file = relative(cwd, abs).split('\\').join('/')
  if (file.startsWith('..') || !existsSync(abs)) return null
  const text = readFileSync(abs, 'utf8')
  const added = insertedText(input)
  const findings = standardsFindings(file, text, { commentsLang: languageFor(config, 'codeComments'), maxLines: config.standards?.maxFileLines ?? 500, onlyLines: linesOf(text, added) })
    // A missing header matters when the file is new; on an edit of an old file it is doctor's job.
    .filter((f) => f.kind !== 'header' || input.tool_name === 'Write')
    .filter((f) => f.kind !== 'language' || linesOf(text, added).has(f.line))
  if (!findings.length) return null
  // Remind once per session, file and kind.
  let seen = {}
  try { seen = JSON.parse(readFileSync(join(cwd, SEEN), 'utf8')) } catch { seen = {} }
  const session = input.session_id ?? 'no-session'
  const fresh = findings.filter((f) => { const key = `${session}:${file}:${f.kind}:${f.line ?? ''}`; if (seen[key]) return false; seen[key] = 1; return true })
  if (!fresh.length) return null
  try { mkdirSync(join(cwd, '.agent-os', 'cache'), { recursive: true }); writeFileSync(join(cwd, SEEN), JSON.stringify(seen)) } catch { /* reminders still go out */ }
  return `agent-os standards (a reminder, not a block): ${fresh.map((f) => f.message).join('; ')}.`
}
