// Tests for the language engine: areas, dictionaries, the ASCII rule for ro and the agents' language rule.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AREAS, LABELS, MILESTONES, languageFor, label, labelSet, milestone, findDiacritics, toAscii, renderLanguageRule } from './i18n.mjs'
import { labels as planLabels } from '../../scripts/github/plan.mjs'
import { withDefaults } from '../config/config.mjs'
import { SCHEMA } from '../config/schema.mjs'

const configWith = (languages) => withDefaults(SCHEMA, { languages })

test('there are eleven areas and only chat is personal', () => {
  assert.equal(AREAS.length, 11)
  assert.deepEqual(AREAS.filter((a) => a.personal).map((a) => a.id), ['chat'])
})

test('each area can be set independently', () => {
  const cfg = configWith({ issues: 'ro', prs: 'en', labels: 'ro', milestones: 'en', chat: 'ro' })
  assert.deepEqual(AREAS.map((a) => [a.id, languageFor(cfg, a.id)]), [
    ['chat', 'ro'], ['issues', 'ro'], ['prs', 'en'], ['commits', 'en'], ['branches', 'en'], ['labels', 'ro'],
    ['milestones', 'en'], ['releases', 'en'], ['codeComments', 'en'], ['docs', 'en'], ['journal', 'en'],
  ])
  assert.throws(() => languageFor(cfg, 'tickets'), /unknown language area "tickets"/)
})

test('with labels=ro, type:bug renders as its ro dictionary name', () => {
  const set = labelSet(configWith({ labels: 'ro' }))
  assert.equal(set.find((l) => l.id === 'type:bug').name, 'tip:bug')
  assert.equal(labelSet(configWith({})).find((l) => l.id === 'type:bug').name, 'type:bug')
})

test('scoped platforms get the exclusive form, only for the first colon', () => {
  assert.equal(label('priority:p0', 'ro', { scoped: true }).name, 'prioritate::p0')
  assert.equal(label('good-first-issue', 'en', { scoped: true }).name, 'good first issue')
})

test('dictionaries cover every core label and milestone in both languages, ro in ASCII', () => {
  for (const entry of [...LABELS.map((l) => [l.id, l.name, l.description]), ...MILESTONES.map((m) => [m.id, m.title, m.description])]) {
    const [id, ...texts] = entry
    for (const t of texts) {
      assert.ok(t.en && t.ro, `${id}: both languages`)
      assert.deepEqual(findDiacritics(t.ro), [], `${id}: ro must be ASCII`)
    }
  }
  for (const lang of ['en', 'ro']) {
    const names = LABELS.map((l) => l.name[lang])
    assert.equal(new Set(names).size, names.length, `${lang}: label names are unique`)
  }
  assert.equal(new Set(LABELS.map((l) => l.id)).size, LABELS.length)
})

test("every generic label this repository uses has a dictionary entry", () => {
  const projectSpecific = (name) => name.startsWith('area:') || name.startsWith('platform:') || ['upstream', 'dogfood'].includes(name)
  const ids = new Set(LABELS.map((l) => l.id))
  const byName = new Map(LABELS.map((l) => [l.name.en, l.id]))
  for (const [name] of planLabels) if (!projectSpecific(name)) assert.ok(ids.has(name) || byName.has(name), `missing core label for ${name}`)
})

test('milestones fill their placeholders', () => {
  assert.equal(milestone('rolling-release', 'ro', { n: 3 }).title, 'Etapa 0 - Release 3 (in lucru)')
  assert.equal(milestone('closed-release', 'en', { n: 2, date: '2026-11-18' }).title, 'Release 2 - 2026-11-18')
  assert.equal(milestone('stage', 'en').title, 'Stage {n}')
})

test('a ro text containing a diacritic fails, with line, column and the ASCII letter', () => {
  assert.deepEqual(findDiacritics('Titlu\nAre ș aici'), [{ line: 2, col: 5, char: 'ș', ascii: 's' }])
})

test('every form of every diacritic is found: comma, cedilla, upper case and decomposed', () => {
  const found = findDiacritics('ă â î ș ț ş ţ Ă Â Î Ș Ț Ş Ţ ă ș').map((f) => f.ascii).join('')
  assert.equal(found, 'aaistst' + 'AAISTST' + 'as')
  assert.deepEqual(findDiacritics('plain ASCII, emoji 🤖 and é are not Romanian diacritics'), [])
})

test('toAscii replaces diacritics and keeps everything else', () => {
  assert.equal(toAscii('Ștefan, Țară, ăîâ, ş ţ, é'), 'Stefan, Tara, aia, s t, é')
})

test('the language rule lists every area with its language and contains no diacritics', () => {
  const rule = renderLanguageRule(configWith({ issues: 'ro' }))
  assert.match(rule, /\| issues \| .* \| Romanian without diacritics/)
  assert.match(rule, /\| prs \| .* \| English \|/)
  assert.match(rule, /\| chat \(personal\) \|/)
  assert.match(rule, /agent-os lang check/)
  assert.deepEqual(findDiacritics(rule), [])
  assert.doesNotMatch(renderLanguageRule(configWith({})), /lang check/)
})

test('every label color is a six-digit hex string, including all-digit ones like 000000', () => {
  for (const l of LABELS) assert.match(label(l.id, 'en').color, /^[0-9a-f]{6}$/, l.id)
  assert.equal(label('blocked', 'en').color, '000000')
})
