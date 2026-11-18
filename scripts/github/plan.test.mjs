// Checks that the GitHub plan follows the package's own issue rules before setup.mjs sends it anywhere.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { labels, milestones, issues } from './plan.mjs'

const labelNames = new Set(labels.map(([name]) => name))
const byKey = new Map(issues.map((it) => [it.key, it]))
const count = (it, prefix) => it.labels.filter((l) => l.startsWith(prefix)).length

test('keys and titles are unique', () => {
  assert.equal(byKey.size, issues.length, 'duplicate issue key')
  const titles = issues.map((it) => it.title)
  assert.equal(new Set(titles).size, titles.length, 'duplicate issue title')
})

test('every label exists and every milestone is planned', () => {
  const milestoneTitles = new Set(milestones.map(([title]) => title))
  for (const it of issues) {
    for (const l of it.labels) assert.ok(labelNames.has(l), `${it.key}: unknown label ${l}`)
    assert.ok(milestoneTitles.has(it.milestone), `${it.key}: unknown milestone ${it.milestone}`)
  }
})

test('every issue has exactly one type, exactly one priority and at least one area', () => {
  for (const it of issues) {
    assert.equal(count(it, 'type:'), 1, `${it.key}: type labels`)
    assert.equal(count(it, 'priority:'), 1, `${it.key}: priority labels`)
    assert.ok(count(it, 'area:') >= 1, `${it.key}: no area label`)
    assert.ok(count(it, 'size:') <= 1, `${it.key}: several size labels`)
  }
})

test('parents are epics and dependencies point to planned issues', () => {
  for (const it of issues) {
    if (it.parent) assert.ok(byKey.get(it.parent)?.epic, `${it.key}: parent ${it.parent} is not an epic`)
    for (const dep of it.blockedBy ?? []) assert.ok(byKey.has(dep), `${it.key}: unknown dependency ${dep}`)
  }
})

test('dependencies have no cycles', () => {
  const state = new Map()
  const visit = (key, path) => {
    if (state.get(key) === 'done') return
    assert.notEqual(state.get(key), 'open', `cycle: ${[...path, key].join(' -> ')}`)
    state.set(key, 'open')
    for (const dep of byKey.get(key).blockedBy ?? []) visit(dep, [...path, key])
    state.set(key, 'done')
  }
  for (const it of issues) visit(it.key, [])
})

test('feature issues have acceptance criteria', () => {
  for (const it of issues.filter((x) => !x.epic)) assert.ok(it.ac?.length, `${it.key}: no acceptance criteria`)
})
