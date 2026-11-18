// Tests for capability probing and fallbacks: GitHub cloud and Enterprise, GitLab tiers, unknown answers, the plans
// skills follow, and the cache.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probeGitHub, probeGitLab, has, planBlockedBy, planParent, planAssignees, CAPABILITIES } from './capabilities.mjs'
import { capabilitiesFor } from './probe.mjs'
import { ghClient } from '../tracker/gh.mjs'
import { glabClient } from './glab.mjs'
import { fakeGh } from '../tracker/__fixtures__/fake-gh.mjs'

/** A fake glab: GET path → body, or { status } for an HTTP error. */
function fakeGlab(routes) {
  const calls = []
  const run = (args) => {
    calls.push(args[1])
    const r = routes[args[1]]
    if (r === undefined || (r && r.httpStatus)) return { status: 1, stdout: '', stderr: `glab: ${r?.httpStatus ?? 404} Not Found (HTTP ${r?.httpStatus ?? 404})` }
    return { status: 0, stdout: JSON.stringify(r), stderr: '' }
  }
  run.calls = calls
  return run
}
const P = 'team/sub/app'
const ID = encodeURIComponent(P)

test('github.com capabilities are known without any request', async () => {
  const gh = fakeGh({})
  const caps = await probeGitHub({ project: 'o/r' }, ghClient(gh))
  assert.equal(gh.calls.length, 0)
  for (const id of ['subItems', 'dependencies', 'multipleAssignees', 'pages', 'branchRules', 'linkedBranches']) assert.equal(has(caps, id), true, id)
  assert.equal(has(caps, 'exclusiveLabels'), false)
  assert.equal(has(caps, 'board'), false, 'no board configured')
})

test('GitHub Enterprise Server is probed: missing endpoints become missing capabilities', async () => {
  const gh = fakeGh({
    'GET repos/o/r/issues?state=all&per_page=1': [{ number: 4 }],
    'GET repos/o/r/issues/4/sub_issues?per_page=1': { status: 1, stderr: 'gh: Not Found (HTTP 404)' },
    'GET repos/o/r/issues/4/dependencies/blocked_by?per_page=1': [],
    'GET repos/o/r/rulesets?per_page=1': [],
    'GET repos/o/r/pages': { status: 1, stderr: 'gh: Not Found (HTTP 404)' },
  })
  const caps = await probeGitHub({ host: 'https://ghe.corp', project: 'o/r' }, ghClient(gh, { host: 'ghe.corp' }))
  assert.deepEqual([caps.subItems.value, caps.subItems.source], [false, 'probed'])
  assert.equal(has(caps, 'dependencies'), true)
  assert.equal(caps.pages.note, 'available, not enabled')
})

test('GitLab Free: no epics or push rules, so blocking links, scoped labels and several assignees are missing', async () => {
  const caps = await probeGitLab({ project: P }, glabClient(fakeGlab({ version: { version: '17.5.1' }, [`projects/${ID}`]: { pages_access_level: 'enabled' }, [`groups/${encodeURIComponent('team/sub')}/epics?per_page=1`]: { httpStatus: 403 } })))
  assert.deepEqual([caps.tier.value, caps.tier.note], ['free', 'GitLab 17.5.1'])
  assert.equal(caps.subItems.value, 'tasks')
  for (const id of ['dependencies', 'exclusiveLabels', 'multipleAssignees', 'branchRules', 'linkedBranches']) assert.equal(has(caps, id), false, id)
  assert.equal(caps.dependencies.source, 'inferred')
  assert.equal(has(caps, 'pages'), true)
})

test('GitLab Premium: epics answer, so the Premium capabilities are on', async () => {
  const caps = await probeGitLab({ project: P }, glabClient(fakeGlab({ version: { version: '17.5.1-ee' }, [`projects/${ID}`]: {}, [`groups/${encodeURIComponent('team/sub')}/epics?per_page=1`]: [], [`projects/${ID}/push_rule`]: { id: 1 } })))
  assert.equal(caps.tier.value, 'premium or ultimate')
  assert.equal(caps.subItems.value, 'epics')
  for (const id of ['dependencies', 'exclusiveLabels', 'multipleAssignees', 'branchRules']) assert.equal(has(caps, id), true, id)
})

test('an unreachable GitLab leaves the tier unknown, and unknown capabilities count as missing', async () => {
  const caps = await probeGitLab({ project: P }, glabClient(() => ({ status: 1, stdout: '', stderr: 'glab: could not connect' })))
  assert.equal(caps.tier.value, 'unknown')
  assert.match(caps.tier.note, /is glab installed and logged in/)
  assert.equal(caps.dependencies.value, null)
  assert.equal(has(caps, 'dependencies'), false)
})

test('given GitLab Free without blocking links, "blocked by" becomes relates-to + the blocked label + a Blocked by line', async () => {
  const caps = await probeGitLab({ project: P }, glabClient(fakeGlab({ version: { version: '17.5.1' }, [`groups/${encodeURIComponent('team/sub')}/epics?per_page=1`]: { httpStatus: 404 } })))
  assert.deepEqual(planBlockedBy(caps, { issue: 12, blocker: 7 }), {
    native: false,
    actions: [{ do: 'link', type: 'relates-to', issue: 12, blocker: 7 }, { do: 'add-label', issue: 12, label: 'blocked' }, { do: 'body-line', issue: 12, line: 'Blocked by #7' }],
  })
  assert.deepEqual(planBlockedBy({ dependencies: { value: true } }, { issue: 12, blocker: 7 }), { native: true, actions: [{ do: 'link', type: 'blocked-by', issue: 12, blocker: 7 }] })
})

test('parent and assignee plans follow the capabilities', () => {
  assert.equal(planParent({ subItems: { value: 'tasks' } }, { child: 3, parent: 1 }).actions[0].type, 'child-task')
  assert.equal(planParent({ subItems: { value: true } }, { child: 3, parent: 1 }).actions[0].type, 'sub-issue')
  assert.deepEqual(planParent({}, { child: 3, parent: 1 }).actions.map((a) => a.do), ['body-line', 'checklist-item'])
  assert.deepEqual(planAssignees({ multipleAssignees: { value: false } }, { issue: 5, logins: ['ana', 'dan', 'ioan'] }).actions, [{ do: 'assign', issue: 5, logins: ['ana'] }, { do: 'comment', issue: 5, text: 'Also working on this: @dan @ioan' }])
  assert.equal(planAssignees({}, { issue: 5, logins: ['ana'] }).native, true)
})

test('every capability documents what it means and its fallback', () => {
  for (const [id, c] of Object.entries(CAPABILITIES)) assert.ok(c.means && c.fallback, id)
})

test('the map is cached per platform and project, and refreshed on request or when they change', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-caps-'))
  try {
    const gh = fakeGh({})
    const config = { platform: { type: 'github', project: 'o/r' } }
    const first = await capabilitiesFor(config, { cwd, gh, now: new Date('2026-11-18T10:00:00Z') })
    assert.equal(first.fromCache, false)
    assert.equal((await capabilitiesFor(config, { cwd, gh, now: new Date('2026-11-18T20:00:00Z') })).fromCache, true)
    assert.equal((await capabilitiesFor(config, { cwd, gh, refresh: true, now: new Date('2026-11-18T20:00:00Z') })).fromCache, false)
    assert.equal((await capabilitiesFor({ platform: { type: 'github', project: 'o/other' } }, { cwd, gh, now: new Date('2026-11-18T21:00:00Z') })).fromCache, false)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
