// Tests for GitHub setup against an in-memory repository: a fresh repo, idempotency, label renames that keep issues,
// existing rulesets, required checks, milestones, and dry runs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planGitHubSetup, desiredRuleset, RULESET_NAME } from './setup-github.mjs'
import { ghClient } from '../tracker/gh.mjs'
import { fakeGitHubRepo } from './__fixtures__/fake-github-repo.mjs'
import { withDefaults } from '../config/config.mjs'
import { SCHEMA } from '../config/schema.mjs'
import { LABELS } from '../i18n/i18n.mjs'

const config = (over = {}) => withDefaults(SCHEMA, { platform: { type: 'github', project: 'acme/app' }, ...over })
const apply = (steps) => steps.forEach((s) => s.apply())

test('given a repo with main only, setup creates development, makes it default and protects both', () => {
  const gh = fakeGitHubRepo()
  const client = ghClient(gh.run)
  apply(planGitHubSetup(config(), client))
  assert.ok(gh.state.branches.development)
  assert.equal(gh.state.branches.development, gh.state.branches.main)
  assert.equal(gh.state.defaultBranch, 'development')
  const rs = gh.state.rulesets.find((r) => r.name === RULESET_NAME)
  assert.deepEqual(rs.conditions.ref_name.include, ['refs/heads/main', 'refs/heads/development'])
  assert.deepEqual(rs.rules.map((r) => r.type), ['deletion', 'non_fast_forward', 'pull_request'])
  assert.equal(gh.state.labels.length, LABELS.length)
  assert.deepEqual(gh.state.milestones.map((m) => m.title), ['Stage 0 - Release 1 (in progress)'])
})

test('setup is idempotent: a second run plans nothing and writes nothing', () => {
  const gh = fakeGitHubRepo()
  const client = ghClient(gh.run)
  apply(planGitHubSetup(config({ branches: { requiredChecks: ['ci'] } }), client))
  const writes = gh.writes.length
  assert.deepEqual(planGitHubSetup(config({ branches: { requiredChecks: ['ci'] } }), client), [])
  assert.equal(gh.writes.length, writes)
})

test('switching labels to ro renames them in place, so they stay on their issues', () => {
  const gh = fakeGitHubRepo({ issues: { 7: { labels: ['type:bug', 'priority:p1'] } } })
  const client = ghClient(gh.run)
  apply(planGitHubSetup(config(), client, { only: ['labels'] }))
  const steps = planGitHubSetup(config({ languages: { labels: 'ro' } }), client, { only: ['labels'] })
  assert.ok(steps.every((s) => s.action === 'rename' || s.action === 'update'), 'renames, plus description updates for names that are the same in both languages')
  assert.ok(steps.filter((s) => s.action === 'rename').length >= 20)
  assert.match(steps.find((s) => s.description.includes('type:bug')).description, /rename label type:bug → tip:bug \(it stays on its issues\)/)
  apply(steps)
  assert.deepEqual(gh.state.issues[7].labels, ['tip:bug', 'prioritate:p1'])
  assert.equal(gh.state.labels.length, LABELS.length, 'renamed, not duplicated')
  assert.ok(!gh.writes.some((w) => w.startsWith('DELETE')))
})

test('labels with the right name but another color or description are updated; unrelated labels are left alone', () => {
  const gh = fakeGitHubRepo({ labels: [{ name: 'type:bug', color: 'ffffff', description: 'old' }, { name: 'area:billing', color: '000000' }] })
  const steps = planGitHubSetup(config(), ghClient(gh.run), { only: ['labels'] })
  assert.ok(steps.some((s) => s.action === 'update' && s.description === 'update label type:bug: color or description'))
  apply(steps)
  assert.ok(gh.state.labels.some((l) => l.name === 'area:billing'))
})

test('an existing ruleset covering both branches is reused and completed, never duplicated', () => {
  const gh = fakeGitHubRepo({ branches: { main: 's', development: 's' }, defaultBranch: 'development', rulesets: [{ name: 'protect main and development', target: 'branch', conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/development'] } }, rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'pull_request', parameters: {} }] }] })
  const client = ghClient(gh.run)
  assert.deepEqual(planGitHubSetup(config(), client, { only: ['ruleset'] }), [], 'already covered')
  const steps = planGitHubSetup(config({ branches: { requiredChecks: ['ci'] } }), client, { only: ['ruleset'] })
  assert.equal(steps.length, 1)
  assert.match(steps[0].description, /update ruleset "protect main and development" \(#100\): add missing rules and required checks ci/)
  apply(steps)
  assert.equal(gh.state.rulesets.length, 1)
  assert.equal(gh.state.rulesets[0].name, 'protect main and development')
  assert.ok(gh.state.rulesets[0].rules.some((r) => r.type === 'required_status_checks'))
})

test('the desired ruleset follows the configured branches, checks and approvals', () => {
  const r = desiredRuleset(config({ branches: { integration: 'develop', production: 'master', requiredChecks: ['ci', 'lint'], requiredApprovals: 1 } }))
  assert.deepEqual(r.conditions.ref_name.include, ['refs/heads/master', 'refs/heads/develop'])
  assert.equal(r.rules.find((x) => x.type === 'pull_request').parameters.required_approving_review_count, 1)
  assert.deepEqual(r.rules.find((x) => x.type === 'required_status_checks').parameters.required_status_checks, [{ context: 'ci' }, { context: 'lint' }])
})

test('the rolling milestone is created after the last release number, or renamed into the milestones language', () => {
  const gh = fakeGitHubRepo({ milestones: [{ title: 'Release 3 - 2026-10-01', state: 'closed' }] })
  assert.match(planGitHubSetup(config(), ghClient(gh.run), { only: ['milestones'] })[0].description, /create milestone "Stage 0 - Release 4 \(in progress\)"/)
  const ro = fakeGitHubRepo({ milestones: [{ title: 'Stage 0 - Release 5 (in progress)' }] })
  const [s] = planGitHubSetup(config({ languages: { milestones: 'ro' } }), ghClient(ro.run), { only: ['milestones'] })
  assert.equal(s.action, 'rename')
  apply([s])
  assert.equal(ro.state.milestones[0].title, 'Etapa 0 - Release 5 (in lucru)')
})

test('planning reads but never writes', () => {
  const gh = fakeGitHubRepo()
  planGitHubSetup(config(), ghClient(gh.run))
  assert.deepEqual(gh.writes, [])
})
