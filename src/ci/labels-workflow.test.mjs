// Tests for the labels workflow (#195): installed only when asked for; the preview runs on pull requests without the
// write secret and only reports; the secret is used only by the apply job on a push to the integration branch
// (GitLab: a protected branch); without a token nothing changes; both pass their own CI review.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planInstall } from '../managed/install.mjs'
import { withDefaults } from '../config/config.mjs'
import { SCHEMA } from '../config/schema.mjs'
import { parse } from '../yaml/yaml.mjs'
import { reviewText } from './review.mjs'

const item = (type, ci) => planInstall(withDefaults(SCHEMA, { platform: { type }, version: '0.4.2', ...(ci ? { ci } : {}) })).items.find((i) => /agent-os-labels\.yml$/.test(i.key))

test('the labels workflow is installed only with ci.labels, and passes its own review on both platforms', () => {
  for (const type of ['github', 'gitlab']) {
    assert.equal(item(type), undefined, `${type}: not by default`)
    const it = item(type, { labels: true })
    assert.deepEqual(reviewText(it.content, it.key).filter((f) => f.level !== 'info'), [], type)
  }
})

test('GitHub: the preview has no write secret and only reports; the secret is used only by the apply job on push', () => {
  const it = item('github', { labels: true, labelsEnvironment: 'labels' })
  assert.doesNotMatch(it.content.replace(/^#.*$/gm, ''), /pull_request_target/, 'never as a trigger (the comment may name it)')
  const wf = parse(it.content)
  assert.deepEqual(Object.keys(wf.on), ['pull_request', 'push'])
  assert.deepEqual(wf.permissions, { contents: 'read' })
  const { preview, apply } = wf.jobs
  assert.equal(preview.if, "github.event_name == 'pull_request'")
  assert.deepEqual(preview.permissions, { contents: 'read', issues: 'read' })
  assert.equal(preview.env.GH_TOKEN, '${{ github.token }}')
  assert.doesNotMatch(JSON.stringify(preview), /secrets\./, 'no secret in the preview')
  assert.match(preview.steps.at(-1).run, /setup --only labels --dry-run/)
  assert.equal(apply.if, "github.event_name == 'push'")
  assert.deepEqual(apply.permissions, { contents: 'read', issues: 'write' })
  assert.equal(apply.environment, 'labels', 'the optional environment')
  assert.match(apply.env.GH_TOKEN, /secrets\.AGENT_OS_LABELS_TOKEN/)
  assert.match(apply.steps.at(-1).run, /if \[ -z "\$GH_TOKEN" \]; then[\s\S]*nothing was changed[\s\S]*exit 0[\s\S]*setup --only labels \|/)
  assert.equal(parse(item('github', { labels: true }).content).jobs.apply.environment, undefined)
})

test('GitLab: the apply job runs only on the protected integration branch; the preview never writes', () => {
  const doc = parse(item('gitlab', { labels: true }).content)
  const apply = doc['agent-os/labels']
  const preview = doc['agent-os/labels-preview']
  assert.equal(apply.rules[0].if, '$CI_COMMIT_BRANCH == "development" && $CI_COMMIT_REF_PROTECTED == "true"')
  assert.match(apply.script[0], /if \[ -z "\$AGENT_OS_LABELS_TOKEN" \]; then[\s\S]*nothing was changed[\s\S]*exit 0/)
  assert.equal(preview.rules[0].if, '$CI_PIPELINE_SOURCE == "merge_request_event"')
  assert.doesNotMatch(preview.script[0], /AGENT_OS_LABELS_TOKEN\b/, 'the write token never reaches the preview')
  assert.match(preview.script[0], /AGENT_OS_LABELS_READ_TOKEN[\s\S]*--dry-run/)
})
