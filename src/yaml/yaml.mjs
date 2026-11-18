// A strict YAML subset parser and emitter with no dependencies. It reads what agent-os files use: block maps and
// lists, inline [] and {}, quoted and plain scalars, comments. It refuses everything else with file:line:column.
//
// Supported: `key: value`, nested blocks by indentation (spaces only), `- item` lists (also directly under a key
// at the same indentation), inline `[a, b]` and `{k: v}`, "double" (JSON escapes) and 'single' quoted strings,
// plain scalars typed as null (null, ~, empty), booleans (true, false), integers, floats or strings, `#` comments.
// Refused: tabs in indentation, anchors (&), aliases (*), tags (!), multiple documents (---, ...),
// block scalars (| and >), merge keys (<<) and duplicate keys.

/** A parse error that points at the file, line and column. */
export class YamlError extends Error {
  constructor(message, { file = '<input>', line, col }) {
    super(`${file}:${line}:${col}: ${message}`)
    this.name = 'YamlError'
    this.file = file
    this.line = line
    this.col = col
    this.reason = message
  }
}

/**
 * Parses YAML text in the supported subset.
 * @param {string} text
 * @param {{ file?: string }} [options] the file name used in error messages
 * @returns {unknown}
 */
export function parse(text, { file = '<input>' } = {}) {
  const lines = tokenize(text, file)
  const state = { lines, i: 0, file }
  if (!lines.length) return null
  // A document that is a single inline value: `[]`, `{a: 1}`, `"text"` or a plain scalar.
  if (lines.length === 1 && !isItem(lines[0].text) && !splitKey(lines[0].text)) {
    const value = parseInline(state, lines[0], lines[0].text, lines[0].indent)
    state.i = 1
    return value
  }
  const value = parseBlock(state, lines[0].indent)
  if (state.i < lines.length) {
    const l = lines[state.i]
    fail(state, l, l.indent, l.indent < lines[0].indent ? 'less indented than the start of the document' : 'unexpected indentation')
  }
  return value
}

// ── Lines ──────────────────────────────────────────────────────────────────

function tokenize(text, file) {
  const out = []
  const raw = text.replace(/^﻿/, '').split(/\r?\n/)
  raw.forEach((source, n) => {
    const line = n + 1
    const lead = source.match(/^[ \t]*/)[0]
    const tab = lead.indexOf('\t')
    if (tab >= 0 && lead.length < source.length) throw new YamlError('tabs are not allowed for indentation; use spaces', { file, line, col: tab + 1 })
    const body = stripComment(source, { file, line }).trimEnd()
    if (!body.trim()) return
    const indent = body.length - body.trimStart().length
    const content = body.slice(indent)
    if (/^(---|\.\.\.)(\s|$)/.test(content) && indent === 0) throw new YamlError('multiple documents (--- or ...) are not supported; use one document per file', { file, line, col: 1 })
    if (/^%/.test(content) && indent === 0) throw new YamlError('directives (%) are not supported', { file, line, col: 1 })
    out.push({ indent, text: content, line, col: indent + 1, source })
  })
  return out
}

/** Removes a `#` comment that starts the line or follows whitespace, outside quotes. */
function stripComment(s, at) {
  let quote = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote === '"') {
      if (c === '\\') i++
      else if (c === '"') quote = null
    } else if (quote === "'") {
      if (c === "'" && s[i + 1] === "'") i++
      else if (c === "'") quote = null
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s[{,:-]/.test(s[i - 1])) quote = c
    } else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i)
    }
  }
  if (quote) throw new YamlError(`unterminated ${quote === '"' ? 'double' : 'single'}-quoted string`, { ...at, col: s.indexOf(quote) + 1 })
  return s
}

const fail = (state, line, col0, message) => { throw new YamlError(message, { file: state.file, line: line.line, col: col0 + 1 }) }
const isItem = (text) => text === '-' || text.startsWith('- ')

// ── Blocks ─────────────────────────────────────────────────────────────────

function parseBlock(state, indent) {
  const first = state.lines[state.i]
  return isItem(first.text) ? parseSequence(state, indent) : parseMapping(state, indent)
}

/** Splits `key: rest` and returns null when the text is not a mapping entry. */
function splitKey(text) {
  if (text.startsWith('"') || text.startsWith("'")) {
    const end = quotedEnd(text, 0)
    if (end < 0) return null
    const after = text.slice(end + 1)
    const m = after.match(/^\s*:(\s+|$)/)
    if (!m) return null
    return { key: unquote(text.slice(0, end + 1)), rest: after.slice(m[0].length), restOffset: end + 1 + m[0].length }
  }
  const m = text.match(/^([^\s[\]{},#&*!|>'"%@`][^#]*?)\s*:(\s+|$)/)
  if (!m) return null
  return { key: m[1], rest: text.slice(m[0].length), restOffset: m[0].length }
}

function parseMapping(state, indent) {
  const map = {}
  while (state.i < state.lines.length) {
    const l = state.lines[state.i]
    if (l.indent < indent) break
    if (l.indent > indent) fail(state, l, l.indent, 'unexpected indentation')
    if (isItem(l.text)) fail(state, l, l.indent, 'a list item where a key was expected')
    const entry = splitKey(l.text)
    if (!entry) fail(state, l, l.indent, 'expected "key: value"')
    const { key, rest, restOffset } = entry
    if (key === '<<') fail(state, l, l.indent, 'merge keys (<<) are not supported')
    if (Object.hasOwn(map, key)) fail(state, l, l.indent, `duplicate key "${key}"`)
    state.i++
    if (rest === '') {
      const next = state.lines[state.i]
      if (next && next.indent > indent) map[key] = parseBlock(state, next.indent)
      else if (next && next.indent === indent && isItem(next.text)) map[key] = parseSequence(state, indent)
      else map[key] = null
    } else {
      map[key] = parseInline(state, l, rest, l.indent + restOffset)
      const next = state.lines[state.i]
      if (next && next.indent > indent) fail(state, next, next.indent, `unexpected indentation after "${key}: ${rest}"`)
    }
  }
  return map
}

function parseSequence(state, indent) {
  const list = []
  while (state.i < state.lines.length) {
    const l = state.lines[state.i]
    if (l.indent < indent) break
    if (l.indent > indent) fail(state, l, l.indent, 'unexpected indentation')
    if (!isItem(l.text)) break
    const content = l.text.slice(1).replace(/^ +/, '')
    const contentIndent = l.indent + (l.text.length - content.length)
    if (content === '') {
      state.i++
      const next = state.lines[state.i]
      list.push(next && next.indent > indent ? parseBlock(state, next.indent) : null)
    } else if (isItem(content) || splitKey(content)) {
      // "- key: value" or "- - x": the content starts a nested block at its own column.
      state.lines[state.i] = { ...l, indent: contentIndent, text: content, col: contentIndent + 1 }
      list.push(parseBlock(state, contentIndent))
    } else {
      state.i++
      list.push(parseInline(state, l, content, contentIndent))
      const next = state.lines[state.i]
      if (next && next.indent > indent) fail(state, next, next.indent, 'unexpected indentation after a list item')
    }
  }
  return list
}

// ── Inline values ──────────────────────────────────────────────────────────

function parseInline(state, line, text, col0) {
  const p = { s: text, i: 0, state, line, col0 }
  const value = flowValue(p, false)
  skipSpace(p)
  if (p.i < p.s.length) inlineFail(p, `unexpected "${p.s[p.i]}"`)
  return value
}

const inlineFail = (p, message) => fail(p.state, p.line, p.col0 + p.i, message)
const skipSpace = (p) => { while (p.s[p.i] === ' ') p.i++ }

function flowValue(p, inFlow) {
  skipSpace(p)
  const c = p.s[p.i]
  if (c === '[') return flowSeq(p)
  if (c === '{') return flowMap(p)
  if (c === '"' || c === "'") {
    const end = quotedEnd(p.s, p.i)
    if (end < 0) inlineFail(p, 'unterminated quoted string')
    const v = unquote(p.s.slice(p.i, end + 1), () => inlineFail(p, 'invalid escape in a double-quoted string'))
    p.i = end + 1
    return v
  }
  if (c === '&') inlineFail(p, 'anchors (&) are not supported')
  if (c === '*') inlineFail(p, 'aliases (*) are not supported')
  if (c === '!') inlineFail(p, 'tags (!) are not supported')
  if ((c === '|' || c === '>') && !inFlow) inlineFail(p, 'block scalars (| and >) are not supported; use a quoted string with \\n')
  const start = p.i
  const stop = inFlow ? /[,\]}]/ : /$^/
  while (p.i < p.s.length && !stop.test(p.s[p.i])) {
    if (inFlow && p.s[p.i] === ':' && (p.s[p.i + 1] === ' ' || p.s[p.i + 1] === undefined)) break
    p.i++
  }
  return plain(p.s.slice(start, p.i).trim())
}

function flowSeq(p) {
  p.i++
  const out = []
  skipSpace(p)
  if (p.s[p.i] === ']') { p.i++; return out }
  for (;;) {
    out.push(flowValue(p, true))
    skipSpace(p)
    if (p.s[p.i] === ',') { p.i++; skipSpace(p); if (p.s[p.i] === ']') { p.i++; return out } continue }
    if (p.s[p.i] === ']') { p.i++; return out }
    inlineFail(p, p.i >= p.s.length ? 'unclosed "[" (inline lists must fit on one line)' : 'expected "," or "]"')
  }
}

function flowMap(p) {
  p.i++
  const out = {}
  skipSpace(p)
  if (p.s[p.i] === '}') { p.i++; return out }
  for (;;) {
    skipSpace(p)
    const keyAt = p.i
    const key = flowValue(p, true)
    if (typeof key === 'object' && key !== null) inlineFail(p, 'inline map keys must be scalars')
    skipSpace(p)
    if (p.s[p.i] !== ':') inlineFail(p, 'expected ":" after an inline map key')
    p.i++
    const k = String(key)
    if (Object.hasOwn(out, k)) { p.i = keyAt; inlineFail(p, `duplicate key "${k}"`) }
    out[k] = flowValue(p, true)
    skipSpace(p)
    if (p.s[p.i] === ',') { p.i++; skipSpace(p); if (p.s[p.i] === '}') { p.i++; return out } continue }
    if (p.s[p.i] === '}') { p.i++; return out }
    inlineFail(p, p.i >= p.s.length ? 'unclosed "{" (inline maps must fit on one line)' : 'expected "," or "}"')
  }
}

// ── Scalars ────────────────────────────────────────────────────────────────

/** Index of the closing quote of the quoted string starting at `start`, or -1. */
function quotedEnd(s, start) {
  const q = s[start]
  for (let i = start + 1; i < s.length; i++) {
    if (q === '"' && s[i] === '\\') { i++; continue }
    if (s[i] === q) {
      if (q === "'" && s[i + 1] === "'") { i++; continue }
      return i
    }
  }
  return -1
}

function unquote(token, onError = () => { throw new Error('invalid escape') }) {
  if (token[0] === "'") return token.slice(1, -1).replace(/''/g, "'")
  try { return JSON.parse(token) } catch { return onError() }
}

const INT = /^[-+]?\d+$/
const FLOAT = /^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/

/** Types a plain scalar: null, booleans, numbers, otherwise the string itself. */
export function plain(s) {
  if (s === '' || s === '~' || s === 'null') return null
  if (s === 'true') return true
  if (s === 'false') return false
  if (INT.test(s)) return Number(s)
  if (FLOAT.test(s)) return Number(s)
  return s
}

// ── Emitter ────────────────────────────────────────────────────────────────

const SAFE = /^[A-Za-z0-9_][A-Za-z0-9 ._/@+()-]*[A-Za-z0-9_/)]$|^[A-Za-z0-9_]$/

/** A scalar in its shortest form that parses back to the same value. */
export function scalar(v) {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean' || typeof v === 'number') return String(v)
  const s = String(v)
  return SAFE.test(s) && plain(s) === s && !/:\s|\s#|\s{2}/.test(s) ? s : JSON.stringify(s)
}

const isScalar = (v) => v === null || typeof v !== 'object'
const isEmpty = (v) => (Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0)
const key = (k) => (/^[A-Za-z0-9_$][A-Za-z0-9_$.<>/-]*$/.test(k) && plain(k) === k ? k : JSON.stringify(k))

/**
 * Emits a value as block YAML that `parse` reads back to an equal value.
 * @param {unknown} value
 * @returns {string}
 */
export function stringify(value) {
  if (isScalar(value) || isEmpty(value)) return `${inline(value)}\n`
  return `${block(value, 0).join('\n')}\n`
}

function inline(v) {
  if (isScalar(v)) return scalar(v)
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`
  return `{${Object.entries(v).map(([k, x]) => `${key(k)}: ${inline(x)}`).join(', ')}}`
}

function block(v, indent) {
  const pad = ' '.repeat(indent)
  const out = []
  if (Array.isArray(v)) {
    for (const item of v) {
      if (isScalar(item) || isEmpty(item)) out.push(`${pad}- ${inline(item)}`)
      else if (Array.isArray(item)) out.push(`${pad}-`, ...block(item, indent + 2))
      else {
        const [first, ...rest] = block(item, indent + 2)
        out.push(`${pad}- ${first.trimStart()}`, ...rest)
      }
    }
    return out
  }
  for (const [k, x] of Object.entries(v)) {
    if (isScalar(x) || isEmpty(x)) out.push(`${pad}${key(k)}: ${inline(x)}`)
    else out.push(`${pad}${key(k)}:`, ...block(x, indent + 2))
  }
  return out
}
