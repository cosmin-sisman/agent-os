// Tests for the lessons store: the card schema, recall (ranking, limit, budget, read-only), search, and the
// lifecycle inbox → active → promoted / retired.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acceptLesson, addLesson, lessonsForIssue, pathsIn, promoteLesson, readLessons, recall, retireLesson, search, validateCard } from './lessons.mjs'

const card = (front, body = 'The lesson. Why. An example.') => `---\n${front}\n---\n\n${body}\n`
function store(cards) {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-lessons-'))
  for (const [p, c] of Object.entries(cards)) { mkdirSync(join(cwd, '.agent-os/lessons', p, '..'), { recursive: true }); writeFileSync(join(cwd, '.agent-os/lessons', p), c) }
  return cwd
}
const DB = card('areas: [db]\npaths: ["src/db/**"]\nkeywords: [migration]\nsource: "#12"\nconfidence: high', 'Write a down migration for every up migration. A failed deploy needs a way back. Example: 0004_add_index.')
const CI = card('areas: [ci]\npaths: [".github/workflows/**"]\nkeywords: [actions, pin]\nsource: "#20"\nconfidence: medium', 'Pin actions by commit SHA. Tags move. Example: actions/checkout@<sha>.')
const UI = card('areas: [ui]\nkeywords: [contrast]\nsource: "#30"\nconfidence: low', 'Check contrast in dark mode too. Users run it. Example: muted text on cards.')

test('given a card with paths src/db/**, when /start runs on an issue touching src/db, the card is recalled and named', () => {
  const cwd = store({ 'active/down-migrations.md': DB, 'active/pin-actions.md': CI })
  try {
    const issue = { title: 'DB: the orders query is slow', body: 'The query in `src/db/orders.ts` scans the whole table.\n\n## Test scenarios\n', labels: ['type:bug', 'area:api'] }
    const lessons = lessonsForIssue(cwd, issue)
    assert.deepEqual(lessons.map((l) => l.id), ['down-migrations'])
    assert.deepEqual(lessons[0].why, ['path src/db/**'])
    assert.equal(lessons[0].text, 'Write a down migration for every up migration.')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('recall ranks by match (paths, areas, keywords, confidence), only active cards, at most N, within the budget', () => {
  const cwd = store({ 'active/down-migrations.md': DB, 'active/pin-actions.md': CI, 'active/contrast.md': UI, 'inbox/2026-11-18T10-00-ana-x.md': DB, 'retired/old.md': DB })
  try {
    const cards = readLessons(cwd)
    const r = recall(cards, { areas: ['ci', 'ui'], paths: ['.github/workflows/ci.yml'], text: 'pin the actions and check contrast' })
    assert.deepEqual(r.lessons.map((l) => l.id), ['pin-actions', 'contrast'])
    assert.ok(r.lessons[0].score > r.lessons[1].score)
    assert.equal(recall(cards, { areas: ['ci', 'ui', 'db'], text: 'migration contrast pin' }, { limit: 1 }).lessons.length, 1)
    const tight = recall(cards, { areas: ['ci', 'ui', 'db'] }, { budget: 20 })
    assert.equal(tight.lessons.length, 1, 'the first card always fits; the rest must fit the budget')
    assert.ok(!recall(cards, { areas: ['db'] }).lessons.some((l) => l.path.includes('/inbox/') || l.path.includes('/retired/')))
    assert.deepEqual(recall(cards, { areas: ['nothing'] }).lessons, [])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('recall never writes: the counters have one writer (/retro)', () => {
  const cwd = store({ 'active/down-migrations.md': DB })
  try {
    const path = join(cwd, '.agent-os/lessons/active/down-migrations.md')
    const before = [readFileSync(path, 'utf8'), statSync(path).mtimeMs]
    for (let i = 0; i < 3; i++) lessonsForIssue(cwd, { title: 'x', body: 'src/db/a.ts', labels: ['area:db'] })
    assert.deepEqual([readFileSync(path, 'utf8'), statSync(path).mtimeMs], before)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('paths are read from issue text: backticks, bare paths and folders', () => {
  assert.deepEqual(pathsIn('see `src/db/orders.ts` and src/api/ and (docs/a.md); not a/b'), ['src/db/orders.ts', 'src/api/', 'docs/a.md', 'a/b'])
})

test('the card schema names each problem', () => {
  const cwd = store({ 'active/bad.md': card('areas: []\nconfidence: sure\nrecalled: -1'), 'active/none.md': 'no front matter' })
  try {
    const [bad, none] = readLessons(cwd)
    assert.deepEqual(validateCard(bad), [
      'areas must be a list with at least one area',
      'a card needs paths or keywords, or recall can only match it by area',
      'source must say where the lesson came from (an issue, PR, review comment or incident)',
      'confidence must be one of low, likely, medium, high',
      'recalled must be a whole number (only /retro updates it)',
    ])
    assert.match(validateCard(none)[0], /no front matter/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('add captures into the inbox, one file per capture; accept, promote and retire move it through its life', () => {
  const cwd = store({})
  try {
    const at = new Date('2026-11-18T10:00:00Z')
    const spec = { text: 'Quote hex colors in YAML. 000000 parses as a number. Example: color: "000000".', areas: ['i18n'], paths: ['**/*.yaml'], keywords: ['yaml', 'colors'], source: '#11', author: 'ana', at }
    const a = addLesson(cwd, spec)
    assert.equal(a.path, '.agent-os/lessons/inbox/2026-11-18T10-00-ana-quote-hex-colors-in-yaml.md')
    assert.match(addLesson(cwd, spec).path, /-2\.md$/, 'a second capture never overwrites the first')
    assert.match(addLesson(cwd, { ...spec, areas: [] }).problems[0], /areas must be a list/)
    const accepted = acceptLesson(cwd, '10-00-ana-quote-hex-colors-in-yaml', { as: 'yaml-hex-colors' })
    assert.equal(accepted.to, '.agent-os/lessons/active/yaml-hex-colors.md')
    assert.match(readFileSync(join(cwd, accepted.to), 'utf8'), /recalled: 0\nfollowed: 0/)
    promoteLesson(cwd, 'yaml-hex-colors', { to: '.claude/rules/yaml.md' })
    assert.match(readFileSync(join(cwd, accepted.to), 'utf8'), /promotedTo: "\.claude\/rules\/yaml\.md"/)
    const r = retireLesson(cwd, 'yaml-hex-colors', { reason: 'the YAML parser now quotes them', at })
    assert.equal(r.to, '.agent-os/lessons/retired/yaml-hex-colors.md')
    assert.match(readFileSync(join(cwd, r.to), 'utf8'), /retired: 2026-11-18\nretiredBecause: the YAML parser now quotes them/)
    assert.deepEqual(readdirSync(join(cwd, '.agent-os/lessons/active')), [])
    assert.deepEqual(search(readLessons(cwd), 'yaml colors').map((h) => h.state), ['inbox'], 'retired cards are searched only with --all')
    assert.deepEqual(search(readLessons(cwd), 'yaml colors', { states: ['retired'] }).map((h) => h.id), ['yaml-hex-colors'])
    assert.throws(() => retireLesson(cwd, 'nope', { reason: 'x' }), /no active or inbox card "nope"/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test("this repository's own lesson cards are valid", () => {
  const cards = readLessons(join(import.meta.dirname, '..', '..'))
  assert.ok(cards.length > 0)
  assert.deepEqual(cards.flatMap((c) => validateCard(c).map((p) => `${c.path}: ${p}`)), [])
})

test('every core skill ends its procedure with a Learn step (the Learn contract)', () => {
  const root = join(import.meta.dirname, '..', '..', 'templates', 'core', '.claude', 'skills')
  for (const name of readdirSync(root)) {
    const text = readFileSync(join(root, name, 'SKILL.md'), 'utf8')
    assert.match(text, /^## (\d+\. )?(Learn|The Learn step)\b/m, `${name}/SKILL.md has no Learn step`)
  }
})
