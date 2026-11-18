// Tests for the template engine: placeholders, escaping per format, conditions, loops, comments, standalone lines,
// errors with positions and determinism.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { render, formatFor, TemplateError } from './engine.mjs'
import { parse } from '../yaml/yaml.mjs'

test('placeholders read nested paths; markdown inserts values as they are', () => {
  assert.equal(render('Hi {{ user.name }}, {{n}} {{flag}} [{{empty}}]', { user: { name: 'Ana' }, n: 3, flag: false, empty: null }), 'Hi Ana, 3 false []')
})

test('json and yaml outputs insert literals that parse back to the same value', () => {
  const ctx = { s: 'a "quoted": value # x', n: 2, list: ['x', 'y: z'], obj: { k: true } }
  const json = render('{"s": {{s}}, "n": {{n}}, "list": {{list}}, "obj": {{obj}}}', ctx, { format: 'json' })
  assert.deepEqual(JSON.parse(json), ctx)
  const yaml = render('s: {{s}}\nn: {{n}}\nlist: {{list}}\nobj: {{obj}}\n', ctx, { format: 'yaml' })
  assert.deepEqual(parse(yaml), ctx)
})

test('triple braces insert the raw value in any format', () => {
  assert.equal(render('"{{{s}}}"', { s: 'plain' }, { format: 'json' }), '"plain"')
})

test('formatFor picks the escaping from the output extension', () => {
  assert.deepEqual(['a.json', 'b.yml', 'c.yaml', 'd.md', 'e'].map(formatFor), ['json', 'yaml', 'yaml', 'markdown', 'markdown'])
})

test('if, else, negation and comparisons', () => {
  const t = '{{#if a}}A{{else}}not A{{/if}} {{#if !b}}no B{{/if}} {{#if kind == "x"}}X{{/if}}{{#if kind != "x"}}other{{/if}}'
  assert.equal(render(t, { a: true, b: [], kind: 'x' }), 'A no B X')
  assert.equal(render(t, { a: 0, b: ['b'], kind: 'y' }), 'not A  other')
})

test('a missing path in a condition is false, not an error', () => {
  assert.equal(render('{{#if pack.stack-postgres}}pg{{else}}none{{/if}}', { pack: {} }), 'none')
})

test('each iterates with a name, this, @index, @first and @last', () => {
  assert.equal(render('{{#each xs as x}}{{@index}}:{{x.n}}{{#if !@last}},{{/if}}{{/each}}', { xs: [{ n: 'a' }, { n: 'b' }] }), '0:a,1:b')
  assert.equal(render('{{#each xs}}[{{this}}]{{/each}}', { xs: [1, 2] }), '[1][2]')
  assert.equal(render('{{#each xs as x}}{{#if @first}}first {{/if}}{{x}}{{/each}}', { xs: ['a'] }), 'first a')
})

test('inner scopes see outer values', () => {
  assert.equal(render('{{#each xs as x}}{{prefix}}{{x}} {{/each}}', { prefix: '-', xs: ['a', 'b'] }), '-a -b ')
})

test('block tags and comments alone on their line leave no blank lines', () => {
  const t = 'top\n{{! comment }}\n{{#if a}}\n  {{#each xs as x}}\n- {{x}}\n  {{/each}}\n{{else}}\nnone\n{{/if}}\nend\n'
  assert.equal(render(t, { a: true, xs: ['1', '2'] }), 'top\n- 1\n- 2\nend\n')
  assert.equal(render(t, { a: false, xs: [] }), 'top\nnone\nend\n')
})

test('inline block tags keep the surrounding text', () => {
  assert.equal(render('a {{#if x}}b{{/if}} c\n', { x: true }), 'a b c\n')
})

test('CRLF templates keep working', () => {
  assert.equal(render('a\r\n{{#if x}}\r\nb\r\n{{/if}}\r\nc', { x: true }), 'a\r\nb\r\nc')
})

const fails = (source, ctx, pattern, line, col) => assert.throws(() => render(source, ctx, { file: 't.md' }), (err) => {
  assert.ok(err instanceof TemplateError)
  assert.match(err.message, pattern)
  assert.equal(`${err.line}:${err.col}`, `${line}:${col}`)
  assert.ok(err.message.startsWith(`t.md:${line}:${col}: `))
  return true
})

test('an unknown placeholder fails with the file, line and column', () => {
  fails('ok\n  {{ missing.value }}', {}, /unknown placeholder "missing\.value"/, 2, 3)
  fails('{{#each nope as x}}{{/each}}', {}, /unknown placeholder "nope"/, 1, 1)
})

test('structural mistakes fail at the right tag', () => {
  fails('{{#if a}}\nx', { a: 1 }, /never closed/, 1, 1)
  fails('x {{/if}}', {}, /does not close any block/, 1, 3)
  fails('{{#each xs as x}}{{/if}}', { xs: [] }, /does not close \{\{#each\}\}/, 1, 18)
  fails('{{else}}', {}, /\{\{else\}\} without an open/, 1, 1)
  fails('{{#unless a}}', {}, /unknown block "#unless a"/, 1, 1)
  fails('{{#each n as x}}{{/each}}', { n: 3 }, /"n" is not a list/, 1, 1)
  fails('{{ a + b }}', {}, /invalid placeholder/, 1, 1)
})

test('rendering is deterministic', () => {
  const t = '{{#each xs as x}}{{x.k}}={{x.v}}\n{{/each}}'
  const ctx = { xs: [{ k: 'b', v: 1 }, { k: 'a', v: 2 }] }
  assert.equal(render(t, ctx), render(t, structuredClone(ctx)))
  assert.equal(render(t, ctx), 'b=1\na=2\n')
})
