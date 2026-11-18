// Asking questions: one helper for every interactive command, with typed answers and defaults. The IO decides how a
// question is asked: menus on a real terminal (io.terminal, src/cli/menu.mjs), a line otherwise (io.ask), a scripted
// list in tests; without a way to ask, defaults apply.

import { CliError } from './errors.mjs'
import { menuAsk } from './menu.mjs'

/**
 * @typedef {object} Question
 * @property {string} key
 * @property {string} text
 * @property {'choice' | 'yesno' | 'int' | 'text'} kind
 * @property {string[]} [choices]
 * @property {Record<string, string>} [descriptions] one line per choice, shown in the menu
 * @property {unknown} default
 * @property {number} [min]
 * @property {number} [max]
 */

/** Parses one answer; returns undefined when it is not valid for the question. */
export function interpret(q, raw) {
  const a = String(raw ?? '').trim().toLowerCase()
  if (a === '') return q.default
  if (q.kind === 'choice') return q.choices.includes(a) ? a : undefined
  if (q.kind === 'yesno') return ['y', 'yes', 'd', 'da', 'true'].includes(a) ? true : ['n', 'no', 'nu', 'false'].includes(a) ? false : undefined
  if (q.kind === 'int') {
    if (!/^\d+$/.test(a)) return undefined
    const n = Number(a)
    return (q.min === undefined || n >= q.min) && (q.max === undefined || n <= q.max) ? n : undefined
  }
  if (q.kind === 'text') { const t = String(raw).trim(); return !q.pattern || q.pattern.test(t) ? t : undefined }
  return undefined
}

const hint = (q) => {
  const def = q.kind === 'yesno' ? (q.default ? 'Y/n' : 'y/N') : `default ${q.default}`
  return q.kind === 'choice' ? `${q.choices.join('/')}, ${def}` : q.kind === 'int' ? `${q.min ?? ''}${q.max !== undefined ? `-${q.max}` : '+'}, ${def}` : def
}

/**
 * Asks one question through `io.ask`, re-asking up to three times on an invalid answer. Without `io.ask`
 * (no terminal, CI) or with `useDefaults`, the default is taken.
 * @param {import('./context.mjs').IO & { ask?: (text: string) => Promise<string> }} io
 * @param {Question} q
 */
export async function ask(io, q, { useDefaults = false } = {}) {
  if (useDefaults || !io.ask) return q.default
  // A real terminal with raw mode gets menus (#268); anything else answers on a line, with the same answers.
  if (io.terminal) return menuAsk(io.terminal, q, interpret)
  for (let attempt = 0; attempt < 3; attempt++) {
    const value = interpret(q, await io.ask(`${q.text} (${hint(q)}) `))
    if (value !== undefined) return value
    io.stderr(`  please answer ${hint(q)}\n`)
  }
  throw new CliError(`no valid answer for "${q.text}"`, { hint: 'run again, or pass the value as a flag (see --help)' })
}
