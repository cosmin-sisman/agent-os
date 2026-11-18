// Tests for the board: desired values from issues, a sync that writes only what differs, notes for options the board
// does not have, graceful degradation without the project scope (one warning), and board creation.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyBoardSync, desiredFields, planBoardSync, BOARD_FIELDS } from './board.mjs'
import { GitHubTracker } from '../tracker/github.mjs'
import { ghClient } from '../tracker/gh.mjs'
import { fakeGh } from '../tracker/__fixtures__/fake-gh.mjs'

const BOARD = { id: 'PVT_1', fields: { Status: { id: 'F_s', options: ['Todo', 'In Progress', 'In Review', 'Done'].map((name) => ({ id: name, name })) }, Priority: { id: 'F_p', options: ['P0', 'P1', 'P2', 'P3'].map((name) => ({ id: name, name })) }, Size: { id: 'F_z', options: ['S', 'M', 'L'].map((name) => ({ id: name, name })) } } }
function fakeTracker({ items = [], issues = [] } = {}) {
  const calls = []
  return { calls, warnings: [], boardInfo: () => BOARD, boardItems: () => items, openIssues: () => issues, get: (n) => issues.find((i) => i.number === n), setStatus: (n, v, { field }) => calls.push([n, field, v]) }
}

test('desired values: Status from state and assignees, Priority and Size from labels in any language', () => {
  assert.deepEqual(desiredFields({ state: 'open', labels: ['prioritate:p1', 'size:m'], assignees: ['ana'] }), { Status: 'In Progress', Priority: 'P1', Size: 'M' })
  assert.deepEqual(desiredFields({ state: 'open', labels: [], assignees: [] }), { Status: 'Todo' })
  assert.deepEqual(desiredFields({ state: 'closed', labels: ['priority:p0'] }), { Status: 'Done', Priority: 'P0' })
  assert.deepEqual(Object.keys(BOARD_FIELDS), ['Priority', 'Size'])
})

test('a sync writes only what differs; closed issues left on the board are set to Done; missing options are noted', () => {
  const t = fakeTracker({
    items: [{ itemId: 'i1', number: 1, state: 'open', fields: { Status: 'Todo', Priority: 'P1' } }, { itemId: 'i2', number: 2, state: 'open', fields: { Status: 'In Progress', Priority: 'P0', Size: 'S' } }, { itemId: 'i9', number: 9, state: 'closed', fields: { Status: 'In Progress' } }],
    issues: [
      { number: 1, state: 'open', labels: ['priority:p1'], assignees: ['ana'] },
      { number: 2, state: 'open', labels: ['priority:p0', 'size:s'], assignees: ['dan'] },
      { number: 3, state: 'open', labels: ['priority:p2', 'size:xl'], assignees: [] },
    ],
  })
  const plan = planBoardSync(t)
  assert.deepEqual(plan.changes.map((c) => `#${c.number} ${c.field} ${c.from} → ${c.to}${c.add ? ' (add)' : ''}`), ['#1 Status Todo → In Progress', '#3 Status null → Todo (add)', '#3 Priority null → P2 (add)', '#9 Status In Progress → Done'])
  assert.deepEqual(plan.missing, ['the board\'s Size has no option "XL" (#3)'])
  assert.deepEqual(t.calls, [], 'planning writes nothing')
  applyBoardSync(t, plan)
  assert.deepEqual(t.calls, [[1, 'Status', 'In Progress'], [3, 'Status', 'Todo'], [3, 'Priority', 'P2'], [9, 'Status', 'Done']])
  const again = fakeTracker({ items: [{ itemId: 'i2', number: 2, state: 'open', fields: { Status: 'In Progress', Priority: 'P0', Size: 'S' } }], issues: [{ number: 2, state: 'open', labels: ['priority:p0', 'size:s'], assignees: ['dan'] }] })
  assert.deepEqual(planBoardSync(again).changes, [], 'a board in step sends nothing')
})

test('given no project scope, /ticket warns once and continues; the sync is skipped, not failed', () => {
  const R = 'repos/acme/app'
  const gh = fakeGh({
    [`POST ${R}/issues`]: (_, k) => ({ number: 50 + k, id: 1, node_id: 'I', title: 't', html_url: 'u', labels: [], assignees: [] }),
    'graphql:repositoryOwner': { status: 1, stderr: "gh: Your token has not been granted the required scopes. The 'id' field requires one of the following scopes: ['read:project']" },
  })
  const t = new GitHubTracker({ repo: 'acme/app', board: { owner: 'acme', number: 7 } }, ghClient(gh, { backoffMs: 1 }))
  assert.equal(t.create({ title: 'One', status: 'Todo' }).number, 51)
  assert.equal(t.create({ title: 'Two', status: 'Todo' }).number, 52)
  assert.equal(t.warnings.length, 1, 'one warning, however many issues')
  assert.match(t.warnings[0], /lacks the "project" scope \(fix: gh auth refresh -s project\)/)
  const plan = planBoardSync(t)
  assert.equal(plan.skipped, true)
  assert.equal(gh.calls.filter((c) => c.key === 'graphql:repositoryOwner').length, 1, 'the board is not asked for again')
})

test('createBoard creates a linked project and the default fields; the dry run lists the steps', () => {
  const gh = fakeGh({
    'graphql:repositoryOwner': { repositoryOwner: { id: 'U_1' }, repository: { id: 'R_1' } },
    'graphql:createProjectV2': { createProjectV2: { projectV2: { id: 'PVT_9', number: 9, url: 'https://github.com/users/acme/projects/9' } } },
    'graphql:createProjectV2Field': { createProjectV2Field: { clientMutationId: null } },
  })
  const t = new GitHubTracker({ repo: 'acme/app' }, ghClient(gh, { backoffMs: 1 }))
  const dry = t.createBoard({ title: 'app', fields: BOARD_FIELDS }, { dryRun: true })
  assert.deepEqual(dry.steps, ['create the project "app" owned by acme and link it to acme/app', 'add the field Priority: P0, P1, P2, P3', 'add the field Size: XS, S, M, L, XL'])
  assert.equal(gh.calls.length, 0)
  const r = t.createBoard({ title: 'app', fields: BOARD_FIELDS })
  assert.equal(r.number, 9)
  assert.deepEqual(gh.calls.find((c) => c.key === 'graphql:createProjectV2').body.variables, { o: 'U_1', t: 'app', r: 'R_1' })
  assert.equal(gh.calls.filter((c) => c.key === 'graphql:createProjectV2Field').length, 2)
})
