// Tests for the GitLab setup: the plan on a fresh project, scoped labels in ro, completing (never replacing) what
// exists, approval rules on Premium only, and a second run that changes nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planGitLabSetup } from './setup-gitlab.mjs'
import { glabClient } from './glab.mjs'
import { fakeGitLabProject } from './__fixtures__/fake-gitlab-project.mjs'
import { LABELS } from '../i18n/i18n.mjs'

const config = (over = {}) => ({ platform: { type: 'gitlab', project: 'team/app' }, branches: { integration: 'development', production: 'main', requiredApprovals: 0, ...(over.branches ?? {}) }, languages: { labels: 'en', milestones: 'en', ...(over.languages ?? {}) } })
const apply = (steps) => { for (const s of steps.filter((x) => x.action !== 'keep')) s.apply() }

test('a fresh project: development created and made default, both branches protected, merge checks, labels, milestone; a second run changes nothing', () => {
  const gl = fakeGitLabProject()
  const client = glabClient(gl.run)
  const steps = planGitLabSetup(config(), client)
  const d = steps.map((s) => s.description)
  assert.ok(d.includes('create branch development from main'))
  assert.ok(d.some((x) => /make development the default branch \(now main\)/.test(x)))
  assert.ok(d.includes('protect main: no direct push, merges by developers and maintainers, no force push'))
  assert.ok(d.includes('protect development: no direct push, merges by developers and maintainers, no force push'))
  assert.ok(d.some((x) => /merge only when the pipeline succeeds/.test(x) && /every thread is resolved/.test(x)))
  assert.equal(steps.filter((s) => s.action === 'create' && s.area === 'labels').length, LABELS.length)
  assert.ok(d.includes('create label type::bug'), 'scoped labels on GitLab')
  apply(steps)
  assert.equal(gl.state.defaultBranch, 'development')
  assert.equal(gl.state.settings.only_allow_merge_if_pipeline_succeeds, true)
  const writes = gl.writes.length
  assert.deepEqual(planGitLabSetup(config(), client), [], 'a second run plans nothing')
  assert.equal(gl.writes.length, writes)
})

test('given labels in ro, scoped labels like tip::bug are created; existing unscoped or en labels are renamed in place', () => {
  const gl = fakeGitLabProject({ labels: [{ name: 'type:bug', color: '#d73a4a', description: 'Something does not work as expected' }, { name: 'priority::p1', color: '#123456', description: 'Our own words' }] })
  const steps = planGitLabSetup(config({ languages: { labels: 'ro' } }), glabClient(gl.run), { only: ['labels'] })
  const d = steps.map((s) => s.description)
  assert.ok(d.includes('rename label type:bug → tip::bug (it stays on its issues; its color stays)'))
  assert.ok(d.some((x) => x.startsWith('rename label priority::p1 → prioritate::p1')))
  assert.ok(d.includes('create label tip::functionalitate'))
  apply(steps)
  assert.ok(gl.state.labels.some((l) => l.name === 'tip::bug' && l.color === '#d73a4a'))
  assert.equal(gl.state.labels.find((l) => l.name === 'prioritate::p1').description, 'Our own words', 'a description someone wrote stays')
  assert.ok(!gl.writes.some((w) => w.startsWith('DELETE')))
})

test('existing protection is kept and reported, never replaced; settings already on are left alone', () => {
  const gl = fakeGitLabProject({ branches: ['main', 'development'], defaultBranch: 'development', protectedBranches: [{ name: 'main', push_access_levels: [{ access_level: 40 }], allow_force_push: false }, { name: 'development', push_access_levels: [{ access_level: 0 }], allow_force_push: false }], settings: { only_allow_merge_if_pipeline_succeeds: true, only_allow_merge_if_all_discussions_are_resolved: true } })
  const steps = planGitLabSetup(config(), glabClient(gl.run), { only: ['branches', 'ruleset'] })
  assert.deepEqual(steps.map((s) => [s.action, s.description]), [['keep', 'keep the protection of main as it is: direct pushes are allowed (agent-os would allow neither; change it in Settings → Repository if you agree)']])
})

test('approvals: a rule on Premium, a note on Free', () => {
  const premium = fakeGitLabProject({ premium: true })
  const steps = planGitLabSetup(config({ branches: { requiredApprovals: 1 } }), glabClient(premium.run), { only: ['ruleset'] })
  assert.ok(steps.some((s) => s.description === 'require 1 approval(s) on merge requests'))
  apply(steps)
  assert.deepEqual(planGitLabSetup(config({ branches: { requiredApprovals: 1 } }), glabClient(premium.run), { only: ['ruleset'] }), [])
  const free = planGitLabSetup(config({ branches: { requiredApprovals: 1 } }), glabClient(fakeGitLabProject().run), { only: ['ruleset'] })
  assert.ok(free.some((s) => s.action === 'keep' && /approval rules need GitLab Premium/.test(s.description)))
})

test('the rolling milestone is created, or renamed into the milestones language', () => {
  const gl = fakeGitLabProject({ milestones: [{ id: 7, title: 'Stage 0 - Release 2 (in progress)', description: 'Ours', state: 'active' }] })
  const steps = planGitLabSetup(config({ languages: { milestones: 'ro' } }), glabClient(gl.run), { only: ['milestones'] })
  assert.deepEqual(steps.map((s) => s.description), ['rename milestone "Stage 0 - Release 2 (in progress)" → "Etapa 0 - Release 2 (in lucru)" (its issues, due date and description stay)'])
  apply(steps)
  assert.equal(gl.state.milestones[0].description, 'Ours')
})

test('agent-os setup --dry-run on a GitLab project lists the plan and writes nothing', async () => {
  const { run } = await import('../cli/main.mjs')
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'aos-glsetup-'))
  try {
    writeFileSync(join(dir, 'agent-os.json'), JSON.stringify({ platform: { type: 'gitlab', project: 'team/app' } }))
    const gl = fakeGitLabProject()
    let stdout = ''
    const code = await run(['setup', '--only', 'branches,ruleset,labels,milestones', '--dry-run'], { stdout: (s) => { stdout += s }, stderr: () => {}, cwd: dir, env: {}, glab: gl.run })
    assert.equal(code, 0)
    assert.match(stdout, /would create branch development from main/)
    assert.match(stdout, /would create label type::feature/)
    assert.deepEqual(gl.writes, [])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
