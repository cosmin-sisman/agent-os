// Interactive questions on a real terminal (#268): an arrow-key menu for a choice, a Yes/No toggle, and a typed line
// with its default shown dimmed. Zero dependencies: node:readline keypress events in raw mode, and ANSI. The terminal
// is always restored, on an answer, an error or Ctrl+C (exit 130). NO_COLOR turns the colors off.

import { emitKeypressEvents } from 'node:readline'
import { CliError } from './errors.mjs'

const ESC = '\x1b['
const CURSOR = { hide: `${ESC}?25l`, show: `${ESC}?25h` }

/**
 * The terminal for menus, or null when there is none: no TTY, no raw mode, or CI. Commands then ask with a line.
 * @param {{ isTTY?: boolean, setRawMode?: Function }} input
 * @param {{ write: (s: string) => unknown, columns?: number }} output
 * @param {Record<string, string | undefined>} env
 */
export function menuTerminal(input, output, env = {}) {
  if (!input?.isTTY || typeof input.setRawMode !== 'function' || env.CI) return null
  return { input, output, color: !('NO_COLOR' in env), step: 0, title: 'agent-os setup' }
}

const styles = (color) => {
  const wrap = (a, b) => (s) => (color ? `${ESC}${a}m${s}${ESC}${b}m` : s)
  return { bold: wrap(1, 22), dim: wrap(2, 22), cyan: wrap(36, 39), green: wrap(32, 39), red: wrap(31, 39), inverse: wrap(7, 27) }
}

/** Cuts plain text to the terminal width so every rendered line takes exactly one row. */
const fit = (s, width) => (s.length > width ? `${s.slice(0, Math.max(1, width - 1))}…` : s)

/**
 * Asks one question with keys. Returns the answer, already valid for the question (`interpret` decides validity).
 * @param {ReturnType<typeof menuTerminal>} term
 * @param {import('./prompt.mjs').Question & { descriptions?: Record<string, string> }} q
 * @param {(q: object, raw: string) => unknown} interpret
 */
export function menuAsk(term, q, interpret) {
  const { input, output } = term
  const s = styles(term.color)
  const width = Math.max(20, (output.columns || 80) - 1)
  const write = (x) => output.write(x)
  if (term.step === 0) write(`${s.bold(term.title)}\n`)
  term.step++
  const lines = String(q.text).split('\n')
  const head = lines.pop()
  for (const l of lines) write(`${l}\n`)
  const question = `${s.cyan('?')} ${s.dim(`[${term.step}]`)} ${s.bold(head)}`
  write(`${question}\n`)
  const questionRows = lines.length ? 0 : Math.ceil((head.length + 6 + String(term.step).length) / (width + 1))

  const state = { cur: Math.max(0, q.kind === 'choice' ? q.choices.indexOf(q.default) : 0), yes: Boolean(q.default), text: '', error: null }
  let drawn = 0
  const view = () => {
    if (q.kind === 'choice') {
      const names = Math.max(...q.choices.map((c) => c.length))
      return [...q.choices.map((c, i) => {
        const desc = q.descriptions?.[c] ? `  ${q.descriptions[c]}` : ''
        const plain = fit(`${i === state.cur ? '❯' : ' '} ${i + 1}. ${c.padEnd(names)}${desc}`, width)
        const [mark, rest] = [plain.slice(0, 1), plain.slice(1)]
        const label = rest.slice(0, 4 + names)
        return i === state.cur ? `${s.cyan(mark)}${s.cyan(s.bold(label))}${s.dim(rest.slice(4 + names))}` : ` ${label}${s.dim(rest.slice(4 + names))}`
      }), s.dim(fit(`↑/↓ or j/k to move, 1-${Math.min(9, q.choices.length)} to pick, Enter to confirm`, width))]
    }
    if (q.kind === 'yesno') {
      const opt = (label, on) => (on ? (term.color ? s.inverse(s.cyan(` ${label} `)) : `[${label}]`) : ` ${label} `)
      return [`  ${opt('Yes', state.yes)} / ${opt('No', !state.yes)}`, s.dim(fit('←/→ or y/n, Enter to confirm', width))]
    }
    const shown = state.text || (q.default === undefined || q.default === '' ? '' : s.dim(String(q.default)))
    return [`  ${s.cyan('›')} ${shown}`, ...(state.error ? [s.red(fit(state.error, width))] : [s.dim(fit(q.default === undefined || q.default === '' ? 'type the answer, Enter to confirm' : 'Enter keeps the default', width))])]
  }
  const clear = (rows) => { if (rows) write(`${ESC}${rows}A\r${ESC}0J`) }
  const render = () => { clear(drawn); const v = view(); write(`${v.join('\n')}\n`); drawn = v.length }

  return new Promise((resolveAnswer, reject) => {
    const restore = () => {
      input.removeListener('keypress', onKey)
      try { input.setRawMode(false) } catch { /* the stream is gone */ }
      input.pause?.()
      write(CURSOR.show)
    }
    const done = (value) => {
      restore()
      clear(drawn + questionRows)
      const shown = q.kind === 'yesno' ? (value ? 'Yes' : 'No') : String(value)
      write(`${s.green('✔')} ${questionRows ? fit(head, width - shown.length - 3) : ''}${questionRows ? ' ' : ''}${s.cyan(shown)}\n`)
      resolveAnswer(value)
    }
    function onKey(str, key = {}) {
      try {
        if (key.ctrl && key.name === 'c') {
          restore()
          write('\n')
          reject(new CliError('cancelled', { code: 130 }))
          return
        }
        if (q.kind === 'choice') {
          if (key.name === 'up' || key.name === 'k') state.cur = (state.cur - 1 + q.choices.length) % q.choices.length
          else if (key.name === 'down' || key.name === 'j' || key.name === 'tab') state.cur = (state.cur + 1) % q.choices.length
          else if (/^[1-9]$/.test(str ?? '') && Number(str) <= q.choices.length) state.cur = Number(str) - 1
          else if (key.name === 'return' || key.name === 'enter') return done(q.choices[state.cur])
          return render()
        }
        if (q.kind === 'yesno') {
          if (['left', 'right', 'tab', 'h', 'l'].includes(key.name)) state.yes = !state.yes
          else if (key.name === 'y') return done(true)
          else if (key.name === 'n') return done(false)
          else if (key.name === 'return' || key.name === 'enter') return done(state.yes)
          return render()
        }
        if (key.name === 'return' || key.name === 'enter') {
          const value = interpret(q, state.text)
          if (value === undefined || value === null) { state.error = `not a valid answer${q.kind === 'int' ? ` (a whole number${q.min !== undefined ? ` from ${q.min}` : ''}${q.max !== undefined ? ` to ${q.max}` : ''})` : ''}`; return render() }
          return done(value)
        }
        if (key.name === 'backspace') state.text = state.text.slice(0, -1)
        else if (str && !key.ctrl && !key.meta && str >= ' ' && str !== '\x7f') state.text += str
        state.error = null
        render()
      } catch (err) { restore(); reject(err) }
    }
    try {
      emitKeypressEvents(input)
      input.setRawMode(true)
      input.on('keypress', onKey)
      input.resume?.()
      write(CURSOR.hide)
      render()
    } catch (err) { restore(); reject(err) }
  })
}
