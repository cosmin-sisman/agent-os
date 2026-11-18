// Tests for the CI reviewer: injection, pinning, permissions, pull_request_target, timeouts and concurrency on GitHub;
// rules, images, includes, injection and timeouts on GitLab; every workflow agent-os generates passes its own review,
// and so do this repository's; the command's exit codes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { kindOf, reviewRepo, reviewText } from './review.mjs'
import { planInstall } from '../managed/install.mjs'
import { withDefaults } from '../config/config.mjs'
import { SCHEMA } from '../config/schema.mjs'
import { run } from '../cli/main.mjs'

const SHA = 'a'.repeat(40)
const rules = (findings) => findings.map((f) => `${f.level}:${f.rule}`)
const GOOD = `name: x
on:
  pull_request:
permissions:
  contents: read
concurrency:
  group: x-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@${SHA} # v4
        with:
          persist-credentials: false
      - run: npm test
`

test('given ${{ github.event.issue.title }} inside run, the review flags injection', () => {
  const wf = GOOD.replace('      - run: npm test\n', '      - run: |\n          echo "Title: ${{ github.event.issue.title }}"\n')
  const f = reviewText(wf, '.github/workflows/x.yml')
  assert.deepEqual(rules(f), ['error:gh-injection'])
  assert.match(f[0].message, /github\.event\.issue\.title.*script injection; set it in `env:`/)
  const safe = GOOD.replace('      - run: npm test\n', '      - env:\n          TITLE: ${{ github.event.issue.title }}\n        run: echo "Title: $TITLE"\n')
  assert.deepEqual(reviewText(safe, '.github/workflows/x.yml'), [], 'through env it is fine')
  for (const e of ['github.head_ref', 'github.event.pull_request.body', 'github.event.comment.body', 'github.event.head_commit.message', 'inputs.name']) {
    assert.deepEqual(rules(reviewText(GOOD.replace('run: npm test', `run: echo \${{ ${e} }}`), '.github/workflows/x.yml')), ['error:gh-injection'], e)
  }
  assert.deepEqual(reviewText(GOOD.replace('run: npm test', 'run: echo ${{ github.sha }}'), '.github/workflows/x.yml'), [], 'trusted context is fine')
})

test('GitHub: permissions, pinning, timeouts, concurrency, credentials, secrets in run and pull_request_target', () => {
  const bad = `on: [pull_request_target]
jobs:
  a:
    runs-on: ubuntu-latest
    permissions: write-all
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - uses: ./local-action
      - run: deploy --token \${{ secrets.TOKEN }}
  b:
    uses: org/repo/.github/workflows/w.yml@main
`
  assert.deepEqual(rules(reviewText(bad, '.github/workflows/x.yml')).sort(), [
    'error:gh-permissions', 'error:gh-permissions', 'error:gh-pin-actions', 'error:gh-pin-actions', 'error:gh-pr-target',
    'warn:gh-concurrency', 'warn:gh-persist-credentials', 'warn:gh-secrets-in-run', 'warn:gh-timeout',
  ].sort())
})

test('GitLab: rules, images, includes, injection, timeouts', () => {
  const bad = `include:
  - remote: https://example.com/ci.yml
  - project: group/templates
    file: ci.yml
image: node
build:
  image: node:latest
  only: [main]
  script:
    - eval "$CI_COMMIT_MESSAGE"
    - echo $CI_MERGE_REQUEST_TITLE
    - echo "$CI_MERGE_REQUEST_TITLE"
.hidden:
  script: [x]
`
  assert.deepEqual(rules(reviewText(bad, '.gitlab-ci.yml')).sort(), ['error:gl-image-tag', 'error:gl-image-tag', 'error:gl-include-ref', 'error:gl-include-ref', 'error:gl-injection', 'error:gl-injection', 'error:gl-rules', 'warn:gl-timeout'].sort())
  const good = 'default:\n  image: "node:22@sha256:' + 'b'.repeat(64) + '"\n  timeout: 10m\n  interruptible: true\nt:\n  rules:\n    - if: $CI_PIPELINE_SOURCE == "merge_request_event"\n  script:\n    - npm test\n'
  assert.deepEqual(reviewText(good, '.gitlab-ci.yml'), [])
})

test('every workflow agent-os generates passes its own review: no errors, no warnings', () => {
  const variants = [
    {}, { version: '0.4.2' },
    { version: '0.4.2', npmRegistry: 'https://npm.corp/', ci: { image: 'registry.corp/node:22', tags: ['internal'] } },
  ]
  let reviewed = 0
  for (const type of ['github', 'gitlab']) {
    for (const lang of ['en', 'ro']) {
      for (const extra of variants) {
        const plan = planInstall(withDefaults(SCHEMA, { platform: { type }, languages: { issues: lang, prs: lang, labels: lang }, ...extra }))
        for (const item of plan.items.filter((i) => kindOf(i.key))) {
          reviewed++
          assert.deepEqual(reviewText(item.content, item.key).filter((f) => f.level !== 'info'), [], `${type}/${lang}/${JSON.stringify(extra)}: ${item.key}`)
        }
      }
    }
  }
  assert.ok(reviewed >= 18, `reviewed ${reviewed}`)
})

test("this repository's own workflows pass the review", () => {
  const r = reviewRepo(fileURLToPath(new URL('../..', import.meta.url)))
  assert.ok(r.files.includes('.github/workflows/ci.yml'))
  assert.deepEqual(r.findings.filter((f) => f.level !== 'info'), [])
})

test('agent-os ci review exits 1 on errors, --strict also on warnings; checklist lists every rule', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-ci-'))
  try {
    mkdirSync(join(cwd, '.github/workflows'), { recursive: true })
    writeFileSync(join(cwd, '.github/workflows/ok.yml'), GOOD.replace('    timeout-minutes: 5\n', ''))
    let out = ''
    const io = { stdout: (s) => { out += s }, stderr: () => {}, cwd, env: {} }
    assert.equal(await run(['ci', 'review'], io), 0)
    assert.match(out, /warn {2}\.github\/workflows\/ok\.yml jobs\.build: every job has `timeout-minutes` \(gh-timeout\)/)
    assert.equal(await run(['ci', 'review', '--strict'], io), 1)
    writeFileSync(join(cwd, '.github/workflows/bad.yml'), GOOD.replace('run: npm test', 'run: echo ${{ github.head_ref }}'))
    assert.equal(await run(['ci', 'review', '.github/workflows/bad.yml'], io), 1)
    out = ''
    assert.equal(await run(['ci', 'checklist'], io), 0)
    assert.match(out, /\(gh-injection\)[\s\S]*\(gl-rules\)/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
