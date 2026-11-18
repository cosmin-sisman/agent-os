// Tests for the YAML subset: every repository file, typing, structures, comments, round trips and refusals.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify, YamlError } from './yaml.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const yamlFiles = () => {
  const files = []
  for (const dir of ['catalog', 'examples']) for (const f of readdirSync(join(root, dir))) if (f.endsWith('.yaml')) files.push(`${dir}/${f}`)
  for (const id of readdirSync(join(root, 'artifacts'))) if (existsSync(join(root, 'artifacts', id, 'artifact.yaml'))) files.push(`artifacts/${id}/artifact.yaml`)
  return files
}

test('parses every YAML file in catalog/, examples/ and artifacts/', () => {
  const files = yamlFiles()
  assert.ok(files.length >= 8, files.join(', '))
  for (const f of files) assert.doesNotThrow(() => parse(readFileSync(join(root, f), 'utf8'), { file: f }), f)
})

test('the catalog parses to its expected shape', () => {
  const read = (f) => parse(readFileSync(join(root, f), 'utf8'), { file: f })
  const techs = read('catalog/technologies.yaml')
  const astro = techs.find((t) => t.id === 'astro')
  assert.deepEqual(astro, { id: 'astro', name: 'Astro', layer: 'public-frontend', language: 'typescript', provider: 'vercel', runtime: 'Static / Serverless', complexity: 2, aiFriendly: 5, note: { en: 'Zero JS by default, ideal for SEO and AI agents', ro: 'Zero JS implicit, ideal pentru SEO si agenti AI' } })
  assert.equal(read('catalog/layers.yaml').length, 24)
  assert.equal(read('catalog/blueprints.yaml')[0].layers[0].tech, 'astro')
})

test('the example stack.yaml mixes block and inline maps', () => {
  const s = parse(readFileSync(join(root, 'examples/stack.yaml'), 'utf8'))
  assert.equal(s.level, 3)
  assert.deepEqual(s.compliance, { euOnly: true })
  assert.deepEqual(s.layers['public-frontend'].paths, ['apps/site/**'])
  assert.deepEqual(s.layers.storage, { tech: 'supabase-storage', status: 'chosen' })
})

test('every repository file survives a round trip through stringify', () => {
  for (const f of yamlFiles()) {
    const v = parse(readFileSync(join(root, f), 'utf8'), { file: f })
    assert.deepEqual(parse(stringify(v)), v, f)
  }
})

test('plain scalars are typed; quoted scalars stay strings', () => {
  assert.deepEqual(parse('a: null\nb: ~\nc:\nd: true\ne: false\nf: 42\ng: -3\nh: 1.5\ni: 1.7.12\nj: "true"\nk: \'3\'\nl: hello world'),
    { a: null, b: null, c: null, d: true, e: false, f: 42, g: -3, h: 1.5, i: '1.7.12', j: 'true', k: '3', l: 'hello world' })
})

test('quotes: JSON escapes in double quotes, doubled quotes in single quotes, # and : inside quotes', () => {
  assert.deepEqual(parse('a: "x: y # z \\n \\u0103"\nb: \'it\'\'s # not a comment\''), { a: 'x: y # z \n ă', b: "it's # not a comment" })
})

test('comments at line start and after values are ignored; # inside a word is kept', () => {
  assert.deepEqual(parse('# head\na: 1  # one\nb: c#d\n  # indented comment\n'), { a: 1, b: 'c#d' })
})

test('nested maps, lists of maps, lists directly under a key and lists of lists', () => {
  const text = [
    'top:', '  inner:', '    x: 1', 'items:', '  - name: a', '    tags: [t1, t2]', '  - name: b', 'flat:', '- one', '- two',
    'matrix:', '  - - 1', '    - 2', '  - [3, 4]', 'empty: []', 'none: {}',
  ].join('\n')
  assert.deepEqual(parse(text), {
    top: { inner: { x: 1 } }, items: [{ name: 'a', tags: ['t1', 't2'] }, { name: 'b' }], flat: ['one', 'two'],
    matrix: [[1, 2], [3, 4]], empty: [], none: {},
  })
})

test('inline maps and lists nest, allow quoted keys and a trailing comma', () => {
  assert.deepEqual(parse('a: {x: [1, {y: "z, w"}], "k k": null,}'), { a: { x: [1, { y: 'z, w' }], 'k k': null } })
})

test('a top-level list and quoted keys', () => {
  assert.deepEqual(parse('- 1\n- "two"\n'), [1, 'two'])
  assert.deepEqual(parse('"key: odd": 1'), { 'key: odd': 1 })
})

test('CRLF line endings and a BOM are accepted', () => {
  assert.deepEqual(parse('\uFEFFa: 1\r\nb:\r\n  - x\r\n'), { a: 1, b: ['x'] })
})

test('an empty document is null', () => {
  assert.equal(parse('# only a comment\n\n'), null)
})

test('tricky strings round-trip', () => {
  const v = { s: ['', ' lead', 'trail ', 'a: b', 'x #y', 'true', '1.0', 'null', '-dash', '[x]', 'ăîș', 'two  spaces', "quote ' and \"", 'line\nbreak'], 'odd key': 1, '': 2, nested: [[], {}, [[1]]] }
  assert.deepEqual(parse(stringify(v)), v)
})

const refuses = (text, pattern, line, col) => {
  assert.throws(() => parse(text, { file: 'x.yaml' }), (err) => {
    assert.ok(err instanceof YamlError)
    assert.match(err.message, pattern)
    assert.equal(err.line, line, `line in: ${err.message}`)
    assert.equal(err.col, col, `col in: ${err.message}`)
    assert.ok(err.message.startsWith(`x.yaml:${line}:${col}: `))
    return true
  })
}

test('a tab-indented file is refused, saying tabs are not allowed and where', () => {
  refuses('a:\n\tb: 1', /tabs are not allowed for indentation/, 2, 1)
  refuses('a:\n  \tb: 1', /tabs are not allowed/, 2, 3)
})

test('anchors, aliases, tags, documents, block scalars and merge keys are refused with their position', () => {
  refuses('a: &x 1', /anchors/, 1, 4)
  refuses('a: *x', /aliases/, 1, 4)
  refuses('a: !str 1', /tags/, 1, 4)
  refuses('---\na: 1', /multiple documents/, 1, 1)
  refuses('a: 1\n...', /multiple documents/, 2, 1)
  refuses('a: |\n  text', /block scalars/, 1, 4)
  refuses('a: >', /block scalars/, 1, 4)
  refuses('<<: {a: 1}', /merge keys/, 1, 1)
})

test('structural errors point at the offending line', () => {
  refuses('a: 1\na: 2', /duplicate key "a"/, 2, 1)
  refuses('a: [1, 2', /unclosed "\["/, 1, 9)
  refuses('a: {x: 1', /unclosed "\{"/, 1, 9)
  refuses('a: 1\n  b: 2', /unexpected indentation/, 2, 3)
  refuses('a:\n  - 1\n  b: 2', /expected|unexpected/, 3, 3)
  refuses('just text', /expected "key: value"/, 1, 1)
  refuses('a: "open', /unterminated double-quoted string/, 1, 4)
  refuses('a: {x: 1, x: 2}', /duplicate key "x"/, 1, 11)
})
