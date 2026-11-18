// /test: scenarios planned into the issue (Given / When / Then; a bug starts with its regression test), the gate's
// results table written into the change request, and the changed logic that has no test. Design §12.

import { labelId } from '../workflow/next.mjs'
import { matches } from '../util/glob.mjs'

export const HEADINGS = {
  scenarios: ['Test scenarios', 'Scenarii de test'],
  what: ['What happens', 'Ce se intampla'],
  expected: ['What should happen', 'Ce ar trebui sa se intample'],
  repro: ['How to reproduce', 'Cum se reproduce'],
  criteria: ['Acceptance criteria', 'Criterii de acceptare'],
  goal: ['Goal', 'Scop'],
}
const WORDS = {
  en: { given: 'Given', when: 'when', then: 'then', regression: 'regression test: it fails before the fix', heading: 'Test scenarios' },
  ro: { given: 'Dat fiind', when: 'cand', then: 'atunci', regression: 'test de regresie: pica inainte de fix', heading: 'Scenarii de test' },
}

/** The text of the first "## …" or "### …" section with one of the names (issue forms render ###), or null. */
export function sectionText(body, names) {
  const text = String(body ?? '').replace(/<!--[\s\S]*?-->/g, '')
  for (const name of names) {
    const m = new RegExp(`^#{2,3}\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mi').exec(text)
    if (!m) continue
    const rest = text.slice(m.index + m[0].length)
    const next = rest.search(/^#{1,3}\s/m)
    return (next === -1 ? rest : rest.slice(0, next)).trim()
  }
  return null
}

const items = (text) => String(text ?? '').split(/\r?\n/).map((l) => l.match(/^\s*[-*]\s+(?:\[([ xX])\]\s+)?(.+)$/)).filter(Boolean).map((m) => ({ done: /x/i.test(m[1] ?? ''), text: m[2].trim() }))
const firstLine = (t) => String(t ?? '').split(/\r?\n/).map((l) => l.replace(/^\s*(\d+\.|[-*])\s*/, '').trim()).find((l) => l && !/^```/.test(l)) ?? null
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Scenarios for an issue: the ones it has, and the ones to add. A bug gets its regression scenario first.
 * @param {{ title: string, body: string, labels: string[] }} issue
 */
export function planScenarios(issue, { lang = 'en' } = {}) {
  const w = WORDS[lang] ?? WORDS.en
  const existing = items(sectionText(issue.body, HEADINGS.scenarios))
  const ids = (issue.labels ?? []).map(labelId)
  const proposed = []
  if (ids.includes('type:bug')) {
    const repro = firstLine(sectionText(issue.body, HEADINGS.repro)) ?? '…'
    const expected = firstLine(sectionText(issue.body, HEADINGS.expected)) ?? '…'
    const what = firstLine(sectionText(issue.body, HEADINGS.what))
    proposed.push(`${w.given} ${repro.replace(/\.$/, '')}, ${w.when} it runs, ${w.then} ${expected.replace(/\.$/, '')}${what ? ` (not "${what.replace(/\.$/, '')}")` : ''} (${w.regression})`)
  }
  for (const c of items(sectionText(issue.body, HEADINGS.criteria))) proposed.push(`${w.given} …, ${w.when} …, ${w.then} ${c.text.replace(/\.$/, '')}`)
  if (!proposed.length && !existing.length) proposed.push(`${w.given} …, ${w.when} …, ${w.then} ${firstLine(sectionText(issue.body, HEADINGS.goal)) ?? issue.title}`)
  const have = new Set(existing.map((e) => norm(e.text)))
  return { existing, proposed: proposed.filter((p) => !have.has(norm(p))) }
}

/** The issue body with the proposed scenarios added to its scenarios section (created when missing). */
export function withScenarios(body, proposed, { lang = 'en' } = {}) {
  if (!proposed.length) return body
  const add = proposed.map((p) => `- [ ] ${p}`).join('\n')
  const text = String(body ?? '')
  for (const name of HEADINGS.scenarios) {
    const re = new RegExp(`^(#{2,3})\\s+${name}\\s*$`, 'mi')
    const m = re.exec(text)
    if (!m) continue
    const start = m.index + m[0].length
    const rest = text.slice(start)
    const next = rest.search(/^#{1,3}\s/m)
    const end = next === -1 ? text.length : start + next
    const current = text.slice(start, end).replace(/\s+$/, '')
    return `${text.slice(0, start)}${current ? `${current}\n` : '\n\n'}${add}\n${next === -1 ? '' : '\n'}${text.slice(end)}`
  }
  return `${text.replace(/\s*$/, '')}\n\n## ${(WORDS[lang] ?? WORDS.en).heading}\n\n${add}\n`
}

/** Scenario lines still unticked in an issue body. */
export const untickedScenarios = (body) => items(sectionText(body, HEADINGS.scenarios)).filter((i) => !i.done).map((i) => i.text)

const CODE = /\.(js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|cs|php|swift|ex|exs|vue|svelte)$/i
const TEST = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[^/]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py)$/i
const stem = (f) => f.split('/').pop().replace(/\.(test|spec)(?=\.)/, '').replace(/^test_/, '').replace(/_test(?=\.)/, '').replace(/\.[^.]+$/, '')

/** The test paths a source file is expected to have under one of testing.map's templates. */
export function expectedTests(file, templates) {
  const parts = file.split('/')
  const base = parts.pop()
  const dot = base.lastIndexOf('.')
  const vars = { dir: parts.join('/') || '.', name: dot > 0 ? base.slice(0, dot) : base, ext: dot > 0 ? base.slice(dot + 1) : '' }
  return templates.map((t) => t.replace(/\{(dir|name|ext)\}/g, (_, k) => vars[k]).replace(/^\.\//, ''))
}

const excluded = (f, exclude) => exclude.some((x) => f.startsWith(x) || matches(f, x))

/**
 * Changed source files with no changed test. A file a testing.map glob matches needs one of the tests its templates
 * name; any other code file needs a changed test with the same stem. Excluded paths, tests, docs and fixtures are
 * never gaps.
 */
export function testGaps(files, { exclude = [], map = {} } = {}) {
  const changed = new Set(files)
  const tests = files.filter((f) => TEST.test(f))
  const stems = new Set(tests.map(stem))
  const mapped = Object.entries(map)
  const ruleOf = (f) => mapped.find(([glob]) => matches(f, glob))
  // A file some template names as a test is a test, even when a source glob also matches it.
  const named = new Set(files.flatMap((f) => { const r = ruleOf(f); return r ? expectedTests(f, r[1]) : [] }))
  return files.filter((f) => {
    if (excluded(f, exclude) || TEST.test(f) || named.has(f) || /(^|\/)(__fixtures__|fixtures|docs?)\//.test(f)) return false
    const rule = ruleOf(f)
    if (rule) return !expectedTests(f, rule[1]).some((t) => changed.has(t))
    return CODE.test(f) && !stems.has(stem(f))
  })
}

const BEGIN = '<!-- agent-os:test-results -->'
const END = '<!-- /agent-os:test-results -->'
/** The change request body with the results table in its own block, replaced on every run. */
export function withResults(body, table) {
  const block = `${BEGIN}\n${table}\n${END}`
  const text = String(body ?? '')
  const a = text.indexOf(BEGIN)
  const b = text.indexOf(END)
  if (a >= 0 && b > a) return `${text.slice(0, a)}${block}${text.slice(b + END.length)}`
  const m = /^##[ \t]+(How it was tested|Cum a fost testat)[ \t]*$/mi.exec(text)
  if (m) { const at = m.index + m[0].length; return `${text.slice(0, at)}\n\n${block}${text.slice(at)}` }
  return `${text.replace(/\s*$/, '')}\n\n## How it was tested\n\n${block}\n`
}
