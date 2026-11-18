// Tests for the interactive menus, driven by a fake TTY: key sequences in, answers out. Arrow keys, j/k and number keys
// pick a choice; ←/→ and y/n answer a yes/no; a text line keeps its default; Ctrl+C restores the terminal and exits 130;
// NO_COLOR has no colors; without a TTY or raw mode the line prompt answers the same.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { menuTerminal } from './menu.mjs'
import { ask } from './prompt.mjs'
import { run } from './main.mjs'

const KEYS = { up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', enter: '\r', backspace: '\x7f', ctrlC: '\x03' }

/** A fake terminal: an input that plays the keys once the question is drawn, and an output that records it. */
function fakeTty(keys, env = {}) {
  const input = new PassThrough()
  input.isTTY = true
  input.raw = []
  input.setRawMode = (on) => { input.raw.push(on) }
  let out = ''
  const output = { columns: 80, write: (s) => { out += s } }
  const term = menuTerminal(input, output, env)
  const queue = [...keys]
  // Each question listens for keypresses while it is open: one key per tick, only while someone listens.
  const feed = () => {
    if (!queue.length) return
    if (input.listenerCount('keypress')) { const k = queue.shift(); input.write(KEYS[k] ?? k) }
    setImmediate(feed)
  }
  setImmediate(feed)
  return { term, input, out: () => out, io: { terminal: term, ask: async () => { throw new Error('the line prompt was used') }, stderr: () => {} } }
}

const PROFILE = { key: 'profile', kind: 'choice', choices: ['greenfield', 'spec-first', 'active', 'maintenance'], default: 'greenfield', descriptions: { greenfield: 'a new project, no code yet' }, text: 'Which profile?' }

test('a choice is an arrow-key menu: ↓ ↓ Enter picks the third, number keys and j/k move, Enter alone keeps the default', async () => {
  assert.equal(await ask(fakeTty(['down', 'down', 'enter']).io, PROFILE), 'active')
  assert.equal(await ask(fakeTty(['4', 'enter']).io, PROFILE), 'maintenance')
  assert.equal(await ask(fakeTty(['j', 'j', 'k', 'enter']).io, PROFILE), 'spec-first')
  assert.equal(await ask(fakeTty(['up', 'enter']).io, PROFILE), 'maintenance', 'it wraps around')
  const t = fakeTty(['enter'])
  assert.equal(await ask(t.io, PROFILE), 'greenfield')
  assert.match(t.out(), /agent-os setup/)
  assert.match(t.out(), /\[1\].*Which profile\?/)
  assert.match(t.out(), /❯.*1\. .*greenfield.*a new project, no code yet/)
  assert.match(t.out(), /✔.*Which profile\?.*greenfield/)
  assert.deepEqual(t.input.raw, [true, false], 'raw mode on, then off')
})

test('a yes/no is a toggle: ←/→ switch, y and n answer at once; a text line keeps its default and refuses invalid input', async () => {
  const YN = { key: 'team', kind: 'yesno', default: true, text: 'Several people?' }
  assert.equal(await ask(fakeTty(['right', 'enter']).io, YN), false)
  assert.equal(await ask(fakeTty(['left', 'left', 'enter']).io, YN), true)
  assert.equal(await ask(fakeTty(['n']).io, YN), false)
  assert.equal(await ask(fakeTty(['y']).io, { ...YN, default: false }), true)
  const PROJECT = { key: 'project', kind: 'text', pattern: /^[\w.-]+\/[\w.-]+$/, default: 'ana/shop', text: 'The project?' }
  assert.equal(await ask(fakeTty(['enter']).io, PROJECT), 'ana/shop')
  const typed = fakeTty(['a', 'c', 'm', 'e', 'enter', '/', 'x', 'x', 'backspace', 'enter'])
  assert.equal(await ask(typed.io, PROJECT), 'acme/x')
  assert.match(typed.out(), /not a valid answer/)
  assert.equal(await ask(fakeTty(['9', 'enter']).io, { key: 'n', kind: 'int', min: 1, max: 32, default: 1, text: 'Sessions?' }), 9)
})

test('Ctrl+C restores the terminal and the command exits 130', async () => {
  const t = fakeTty(['down', 'ctrlC'])
  await assert.rejects(ask(t.io, PROFILE), (err) => err.code === 130)
  assert.deepEqual(t.input.raw, [true, false])
  assert.ok(t.out().endsWith('\x1b[?25h\n'), 'the cursor is shown again')

  const cwd = mkdtempSync(join(tmpdir(), 'aos-menu-'))
  try {
    const c = fakeTty(['ctrlC'])
    let err = ''
    const code = await run(['init', '--me'], { stdout: () => {}, stderr: (s) => { err += s }, cwd, env: {}, ask: c.io.ask, terminal: c.term })
    assert.equal(code, 130)
    assert.match(err, /cancelled/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('NO_COLOR draws the menu without colors', async () => {
  const t = fakeTty(['enter'], { NO_COLOR: '1' })
  await ask(t.io, PROFILE)
  assert.doesNotMatch(t.out(), /\x1b\[\d+(;\d+)?m/, 'no SGR color codes')
  assert.match(t.out(), /❯ 1\. greenfield/)
})

test('without a TTY, raw mode or outside CI the line prompt is used, with the same answers', async () => {
  assert.equal(menuTerminal({ isTTY: false, setRawMode() {} }, { write() {} }), null)
  assert.equal(menuTerminal({ isTTY: true }, { write() {} }), null, 'no raw mode')
  assert.equal(menuTerminal({ isTTY: true, setRawMode() {} }, { write() {} }, { CI: 'true' }), null)
  const asked = []
  const line = { ask: async (q) => { asked.push(q); return 'active' }, stderr: () => {} }
  assert.equal(await ask(line, PROFILE), 'active')
  assert.match(asked[0], /Which profile\? \(greenfield\/spec-first\/active\/maintenance, default greenfield\)/)
})

test('init --me runs on the menus end to end', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-menu-'))
  try {
    // chat: ↓ to ro; sessions: Enter keeps 1; free memory: 2000.
    const t = fakeTty(['down', 'enter', 'enter', '2', '0', '0', '0', 'enter'])
    let out = ''
    const code = await run(['init', '--me'], { stdout: (s) => { out += s }, stderr: () => {}, cwd, env: {}, ask: t.io.ask, terminal: t.term })
    assert.equal(code, 0, out)
    const local = JSON.parse(readFileSync(join(cwd, '.agent-os/local.json'), 'utf8'))
    assert.deepEqual([local.languages.chat, local.machine.maxWorkers, local.machine.minFreeMb], ['ro', 1, 2000])
    assert.match(t.out(), /Romanian, without diacritics/)
    assert.equal((t.out().match(/✔/g) ?? []).length, 3)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
