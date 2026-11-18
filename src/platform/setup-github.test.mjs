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
  assert.deepEqual(rs.rules.map((r) => r.type), ['deletion', 'non_fast_forward', 'pull_request', 'required_status_checks'])
  assert.deepEqual(rs.rules[3].parameters.required_status_checks, [{ context: 'agent-os/loop' }], 'the loop check is always required')
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
  assert.match(steps.find((s) => s.description.includes('type:bug')).description, /rename label type:bug → tip:bug \(it stays on its issues; its color stays\)/)
  apply(steps)
  assert.deepEqual(gh.state.issues[7].labels, ['tip:bug', 'prioritate:p1'])
  assert.equal(gh.state.labels.length, LABELS.length, 'renamed, not duplicated')
  assert.ok(!gh.writes.some((w) => w.startsWith('DELETE')))
})

test('existing labels are completed, never replaced: color and own descriptions stay; unrelated labels are left alone', () => {
  const gh = fakeGitHubRepo({ labels: [
    { name: 'type:bug', color: 'ffffff', description: 'Our team bug label' },
    { name: 'type:feature', color: '1f6feb', description: '' },
    { name: 'priority:p1', color: '123456', description: 'Prioritate mare' },
    { name: 'area:billing', color: '000000' },
  ] })
  const steps = planGitHubSetup(config(), ghClient(gh.run), { only: ['labels'] })
  const about = (name) => steps.find((s) => s.description.includes(` ${name} `) || s.description.endsWith(` ${name}`))
  assert.equal(about('type:bug').action, 'keep')
  assert.equal(about('type:bug').description, 'keep label type:bug as it is: color #ffffff (the convention uses #d73a4a) and its own description')
  assert.equal(about('type:feature').action, 'update')
  assert.match(about('type:feature').description, /set the description of label type:feature \(it had none\); its color stays/)
  apply(steps)
  const label = (n) => gh.state.labels.find((l) => l.name === n)
  assert.equal(label('type:bug').color, 'ffffff')
  assert.equal(label('type:bug').description, 'Our team bug label')
  assert.equal(label('type:feature').description, 'A new capability')
  assert.equal(label('priority:p1').color, '123456', 'a custom color is never changed')
  assert.ok(gh.state.labels.some((l) => l.name === 'area:billing'))
  assert.ok(!gh.writes.some((w) => w.startsWith('DELETE')))
})

test('an existing ruleset covering both branches is reused and completed, never duplicated', () => {
  const gh = fakeGitHubRepo({ branches: { main: 's', development: 's' }, defaultBranch: 'development', rulesets: [{ name: 'protect main and development', target: 'branch', conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/development'] } }, rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'pull_request', parameters: {} }, { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'agent-os/loop' }] } }] }] })
  const client = ghClient(gh.run)
  assert.deepEqual(planGitHubSetup(config(), client, { only: ['ruleset'] }), [], 'already covered')
  const steps = planGitHubSetup(config({ branches: { requiredChecks: ['ci'] } }), client, { only: ['ruleset'] })
  assert.equal(steps.length, 1)
  assert.match(steps[0].description, /update ruleset "protect main and development" \(#100\): required checks: agent-os\/loop \(existing\) \+ ci \(new\); other rules and checks are kept as they are/)
  apply(steps)
  assert.equal(gh.state.rulesets.length, 1)
  assert.equal(gh.state.rulesets[0].name, 'protect main and development')
  assert.ok(gh.state.rulesets[0].rules.some((r) => r.type === 'required_status_checks'))
})

test('the desired ruleset follows the configured branches, checks and approvals', () => {
  const r = desiredRuleset(config({ branches: { integration: 'develop', production: 'master', requiredChecks: ['ci', 'lint'], requiredApprovals: 1 } }))
  assert.deepEqual(r.conditions.ref_name.include, ['refs/heads/master', 'refs/heads/develop'])
  assert.equal(r.rules.find((x) => x.type === 'pull_request').parameters.required_approving_review_count, 1)
  assert.deepEqual(r.rules.find((x) => x.type === 'required_status_checks').parameters.required_status_checks, [{ context: 'ci' }, { context: 'lint' }, { context: 'agent-os/loop' }])
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

test('an existing required check with an integration_id, and existing rule parameters, are kept as they are; only the new check is added', () => {
  const live = {
    name: 'protect main and development', target: 'branch', enforcement: 'active', conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/development'], exclude: [] } },
    rules: [
      { type: 'deletion' }, { type: 'non_fast_forward' },
      { type: 'pull_request', parameters: { allowed_merge_methods: ['merge', 'squash', 'rebase'], required_approving_review_count: 0, require_extra_approval_for_unattributed_changes: true, required_review_thread_resolution: true } },
      { type: 'required_status_checks', parameters: { do_not_enforce_on_create: false, strict_required_status_checks_policy: false, required_status_checks: [{ context: 'ci', integration_id: 15368 }] } },
    ],
  }
  const gh = fakeGitHubRepo({ branches: { main: 's', development: 's' }, defaultBranch: 'development', rulesets: [structuredClone(live)] })
  const client = ghClient(gh.run)
  const steps = planGitHubSetup(config({ branches: { requiredChecks: ['ci'] } }), client, { only: ['ruleset'] })
  assert.equal(steps.length, 1)
  assert.match(steps[0].description, /required checks: ci \(existing\) \+ agent-os\/loop \(new\)/)
  apply(steps)
  const after = gh.state.rulesets[0]
  assert.deepEqual(after.rules.slice(0, 3), live.rules.slice(0, 3), 'deletion, non_fast_forward and pull_request (with its parameters) untouched')
  assert.deepEqual(after.rules[3].parameters, { do_not_enforce_on_create: false, strict_required_status_checks_policy: false, required_status_checks: [{ context: 'ci', integration_id: 15368 }, { context: 'agent-os/loop' }] })
  assert.equal(after.rules.length, 4)
  assert.deepEqual(planGitHubSetup(config({ branches: { requiredChecks: ['ci'] } }), client, { only: ['ruleset'] }), [], 'a second run plans nothing')
})
