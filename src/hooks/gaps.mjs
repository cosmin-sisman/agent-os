// The Stop reminder for test gaps: when the agent finishes a turn, changed source files with no changed test are
// named once. It never blocks the stop (no decision is returned), and the same set of gaps is not repeated in a
// session, so it cannot loop or nag.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { changedFiles } from '../gate/gate.mjs'
import { testGaps } from '../testing/test.mjs'

const CACHE = ['.agent-os', 'cache', 'test-gaps.json']

/** The reminder text, or null when there are no gaps, the base cannot be diffed, or this set was already reported. */
export function gapsReminder(input, { config, cwd, git }) {
  if (input?.stop_hook_active) return null
  let files
  try { files = changedFiles(git, config.branches?.integration ?? 'development') } catch { return null }
  const gaps = testGaps(files, { exclude: config.testing?.exclude ?? [], map: config.testing?.map ?? {} })
  const file = join(cwd, ...CACHE)
  let seen = {}
  try { seen = JSON.parse(readFileSync(file, 'utf8')) } catch { seen = {} }
  const session = input?.session_id ?? 'no-session'
  const key = gaps.join('\n')
  if (!gaps.length || seen[session] === key) return null
  try {
    if (!existsSync(join(cwd, CACHE[0], CACHE[1]))) mkdirSync(join(cwd, CACHE[0], CACHE[1]), { recursive: true })
    writeFileSync(file, JSON.stringify({ ...seen, [session]: key }))
  } catch { /* a reminder that cannot be remembered is still shown */ }
  const list = gaps.slice(0, 8).join(', ') + (gaps.length > 8 ? `, … (${gaps.length - 8} more)` : '')
  return `agent-os test gaps: ${gaps.length} changed file(s) with no changed test: ${list}. Add the tests the issue's scenarios describe, or say in the change request why none is needed (testing.exclude and testing.map in agent-os.json tune this).`
}
