// The template engine: placeholders, conditions, loops and comments, escaped for the output's format, with
// errors that point at file:line:column. Rendering is a pure function of the template and the context.
//
// Syntax
//   {{ path.to.value }}        the value, escaped for the output format (markdown: as is; json/yaml: a literal)
//   {{{ path }}}               the value as is, in any format
//   {{#if expr}} … {{else}} … {{/if}}    expr: path, !path, path == "text", path != "text"
//   {{#each path as item}} … {{/each}}   also {{@index}}, {{@first}}, {{@last}}; without "as", the item is {{this}}
//   {{! comment }}             removed; {{! area: issues }} on the first line declares the language area
// A block tag alone on its line removes the whole line, so templates stay readable without blank-line noise.

import { scalar as yamlScalar } from '../yaml/yaml.mjs'

export class TemplateError extends Error {
  constructor(message, { file = '<template>', line, col }) {
    super(`${file}:${line}:${col}: ${message}`)
    this.name = 'TemplateError'
    this.file = file
    this.line = line
    this.col = col
  }
}

/** The escaping format for an output path: json, yaml or markdown (everything else). */
export function formatFor(path) {
  if (/\.json$/i.test(path)) return 'json'
  if (/\.ya?ml$/i.test(path)) return 'yaml'
  return 'markdown'
}

/**
 * Renders a template.
 * @param {string} source
 * @param {object} context
 * @param {{ file?: string, format?: 'markdown' | 'json' | 'yaml' }} [options]
 * @returns {string}
 */
export function render(source, context, { file = '<template>', format = 'markdown' } = {}) {
  const tokens = tokenize(source, file)
  const tree = build(tokens, file)
  return evaluate(tree, [context], { file, format })
}

// ── Tokens ─────────────────────────────────────────────────────────────────

const TAG = /\{\{\{\s*([^}]*?)\s*\}\}\}|\{\{\s*([^}]*?)\s*\}\}/g

function position(source, index) {
  const before = source.slice(0, index)
  const line = before.split('\n').length
  return { line, col: index - before.lastIndexOf('\n') }
}

function tokenize(source, file) {
  const tokens = []
  let last = 0
  for (const m of source.matchAll(TAG)) {
    if (m.index > last) tokens.push({ type: 'text', value: source.slice(last, m.index) })
    const at = position(source, m.index)
    const raw = m[1] !== undefined
    const body = (raw ? m[1] : m[2]).trim()
    let token
    if (raw) token = { type: 'out', expr: body, raw: true }
    else if (body.startsWith('!')) token = { type: 'comment' }
    else if (body.startsWith('#if ')) token = { type: 'if', expr: body.slice(4).trim() }
    else if (body.startsWith('#each ')) token = { type: 'each', expr: body.slice(6).trim() }
    else if (body === 'else') token = { type: 'else' }
    else if (body === '/if' || body === '/each') token = { type: 'close', block: body.slice(1) }
    else if (body.startsWith('#') || body.startsWith('/')) throw new TemplateError(`unknown block "${body}"`, { file, ...at })
    else token = { type: 'out', expr: body, raw: false }
    tokens.push({ ...token, ...at, start: m.index, end: m.index + m[0].length })
    last = m.index + m[0].length
  }
  if (last < source.length) tokens.push({ type: 'text', value: source.slice(last) })
  return standalone(tokens, source)
}

/**
 * Drops the line of a block tag or comment that stands alone on it (only spaces around it in the source),
 * so `{{#if}}` lines leave no blank lines behind. Decided on the original source, so consecutive block lines work.
 */
function standalone(tokens, source) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (!['if', 'each', 'else', 'close', 'comment'].includes(t.type)) continue
    const lineStart = source.lastIndexOf('\n', t.start - 1) + 1
    const nl = source.indexOf('\n', t.end)
    const lineEnd = nl === -1 ? source.length : nl
    if (!/^[ \t]*$/.test(source.slice(lineStart, t.start)) || !/^[ \t]*\r?$/.test(source.slice(t.end, lineEnd))) continue
    const prev = tokens[i - 1]
    const next = tokens[i + 1]
    if (prev?.type === 'text') prev.value = prev.value.replace(/[ \t]*$/, '')
    if (next?.type === 'text') next.value = next.value.replace(/^[ \t]*\r?(\n|$)/, '')
  }
  return tokens
}

// ── Tree ───────────────────────────────────────────────────────────────────

function build(tokens, file) {
  const root = { type: 'root', children: [] }
  const stack = [root]
  for (const t of tokens) {
    const top = stack.at(-1)
    const into = top.inElse ? top.otherwise : top.children
    if (t.type === 'text' || t.type === 'out') into.push(t)
    else if (t.type === 'if' || t.type === 'each') {
      const node = { ...t, children: [], otherwise: [] }
      into.push(node)
      stack.push(node)
    } else if (t.type === 'else') {
      if (top.type !== 'if' || top.inElse) throw new TemplateError('{{else}} without an open {{#if}}', { file, line: t.line, col: t.col })
      top.inElse = true
    } else if (t.type === 'close') {
      if (top.type !== t.block) throw new TemplateError(`{{/${t.block}}} does not close ${top.type === 'root' ? 'any block' : `{{#${top.type}}} from line ${top.line}`}`, { file, line: t.line, col: t.col })
      stack.pop()
    }
  }
  if (stack.length > 1) {
    const open = stack.at(-1)
    throw new TemplateError(`{{#${open.type} ${open.expr}}} is never closed`, { file, line: open.line, col: open.col })
  }
  return root
}

// ── Evaluation ─────────────────────────────────────────────────────────────

const MISSING = Symbol('missing')

function lookup(path, scopes) {
  if (path === 'this') return scopes.at(-1).this ?? MISSING
  const parts = path.split('.')
  for (let s = scopes.length - 1; s >= 0; s--) {
    const scope = scopes[s]
    if (scope && typeof scope === 'object' && Object.hasOwn(scope, parts[0])) {
      let v = scope[parts[0]]
      for (const p of parts.slice(1)) {
        if (v === null || typeof v !== 'object' || !Object.hasOwn(v, p)) return MISSING
        v = v[p]
      }
      return v
    }
  }
  return MISSING
}

const truthy = (v) => v !== MISSING && v !== undefined && v !== null && v !== false && v !== '' && v !== 0 && !(Array.isArray(v) && v.length === 0)

function condition(expr, scopes, at) {
  const cmp = expr.match(/^(\S+)\s*(==|!=)\s*"([^"]*)"$/)
  if (cmp) {
    const v = lookup(cmp[1], scopes)
    const equal = v !== MISSING && String(v) === cmp[3]
    return cmp[2] === '==' ? equal : !equal
  }
  if (!/^!?[\w@.-]+$/.test(expr)) throw new TemplateError(`invalid condition "${expr}"`, at)
  return expr.startsWith('!') ? !truthy(lookup(expr.slice(1), scopes)) : truthy(lookup(expr, scopes))
}

function escape(value, format) {
  if (format === 'json') return JSON.stringify(value)
  if (format === 'yaml') return Array.isArray(value) || (value && typeof value === 'object') ? JSON.stringify(value) : yamlScalar(value)
  if (value === null) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function evaluate(node, scopes, opts) {
  let out = ''
  for (const child of node.children) {
    const at = { file: opts.file, line: child.line, col: child.col }
    if (child.type === 'text') out += child.value
    else if (child.type === 'out') {
      if (!/^[\w@.-]+$/.test(child.expr)) throw new TemplateError(`invalid placeholder "${child.expr}"`, at)
      const v = lookup(child.expr, scopes)
      if (v === MISSING || v === undefined) throw new TemplateError(`unknown placeholder "${child.expr}"`, at)
      out += child.raw ? (v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)) : escape(v, opts.format)
    } else if (child.type === 'if') {
      out += evaluate(condition(child.expr, scopes, at) ? child : { children: child.otherwise }, scopes, opts)
    } else if (child.type === 'each') {
      const m = child.expr.match(/^([\w@.-]+)(?:\s+as\s+(\w+))?$/)
      if (!m) throw new TemplateError(`invalid loop "${child.expr}"; use {{#each list as item}}`, at)
      const list = lookup(m[1], scopes)
      if (list === MISSING || list === undefined) throw new TemplateError(`unknown placeholder "${m[1]}"`, at)
      if (!Array.isArray(list)) throw new TemplateError(`"${m[1]}" is not a list`, at)
      list.forEach((item, i) => {
        const scope = { '@index': i, '@first': i === 0, '@last': i === list.length - 1, this: item }
        if (m[2]) scope[m[2]] = item
        out += evaluate(child, [...scopes, scope], opts)
      })
    }
  }
  return out
}
