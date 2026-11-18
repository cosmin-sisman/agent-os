// Tests for artifact link: on a ro issue the comment is ro and ASCII, the repository copy is always the first link
// (the site second), the ref is recorded once in artifact.yaml, a change request is commented as one, and a dry run
// posts and writes nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'
import { findDiacritics } from '../i18n/i18n.mjs'
import { withRef } from './link.mjs'

function project(extra = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-link-'))
  writeFileSync(join(cwd, 'agent-os.json'), JSON.stringify({ platform: { type: 'github', project: 'acme/app' }, ...extra }))
  mkdirSync(join(cwd, 'artifacts/2026-11-18-queues'), { recursive: true })
  writeFileSync(join(cwd, 'artifacts/2026-11-18-queues/artifact.yaml'), 'id: 2026-11-18-queues\ntitle: "Opțiuni de coadă"\ntype: comparison\nkind: snapshot\nstatus: current\nsummary: "pg-boss față de BullMQ, cu costuri și riscuri."\nrefs: ["#3"]\n')
  writeFileSync(join(cwd, 'artifacts/2026-11-18-queues/index.html'), '<p>x</p>')
  return cwd
}
function tracker(comments) {
  const posted = []
  return { posted, comments: () => comments, get: (n) => ({ number: n, body: '' }), comment: (n, body) => posted.push(['issue', n, body]), commentChangeRequest: (n, body) => posted.push(['cr', n, body]) }
}
async function cli(cwd, argv, t) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {}, tracker: t })
  return { code, stdout, stderr }
}

test('given link on a ro issue, the comment is in ASCII ro, with the repository copy first', async () => {
  const cwd = project({ artifacts: { siteUrl: 'https://acme.github.io/app/' } })
  try {
    const t = tracker([{ author: 'ana', body: 'Putem compara cozile? Nu stiu care e mai buna pentru noi.' }])
    const r = await cli(cwd, ['artifact', 'link', '2026-11-18-queues', '#42'], t)
    assert.equal(r.code, 0, r.stderr)
    const [[kind, n, body]] = t.posted
    assert.deepEqual([kind, n], ['issue', 42])
    assert.deepEqual(findDiacritics(body), [], 'ASCII ro')
    assert.match(body, /^\*\*Artefact: Optiuni de coada\*\* \(comparison, stare current\)\n\npg-boss fata de BullMQ/)
    const links = [...body.matchAll(/https?:\/\/\S+/g)].map((m) => m[0])
    assert.deepEqual(links, ['https://github.com/acme/app/tree/development/artifacts/2026-11-18-queues', 'https://acme.github.io/app/2026-11-18-queues/'], 'the repository copy first, the site second')
    assert.match(body, /- In repository: https:\/\/github\.com/)
    assert.match(readFileSync(join(cwd, 'artifacts/2026-11-18-queues/artifact.yaml'), 'utf8'), /^refs: \["#3", "#42"\]$/m)
    await cli(cwd, ['artifact', 'link', '2026-11-18-queues', '#42'], tracker([]))
    assert.equal((readFileSync(join(cwd, 'artifacts/2026-11-18-queues/artifact.yaml'), 'utf8').match(/#42/g) ?? []).length, 1, 'recorded once')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('an en thread gets English; a change request is commented as one; a dry run posts and writes nothing', async () => {
  const cwd = project()
  try {
    const t = tracker([{ author: 'dan', body: 'Could you link the comparison here, please? It would help the review.' }])
    const dry = await cli(cwd, ['artifact', 'link', '2026-11-18-queues', '!7', '--dry-run'], t)
    assert.match(dry.stdout, /would comment on !7 \(en\)/)
    assert.deepEqual(t.posted, [])
    assert.doesNotMatch(readFileSync(join(cwd, 'artifacts/2026-11-18-queues/artifact.yaml'), 'utf8'), /!7/)
    await cli(cwd, ['artifact', 'link', '2026-11-18-queues', '!7'], t)
    assert.equal(t.posted[0][0], 'cr')
    assert.match(t.posted[0][2], /^\*\*Artifact: Opțiuni de coadă\*\*[\s\S]*- In the repository: https:\/\/github\.com\/acme\/app\/tree\/development\/artifacts\/2026-11-18-queues$/)
    assert.match((await cli(cwd, ['artifact', 'link', 'nope', '#1'], t)).stderr, /no artifact "nope"/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('refs are added in the inline or the block form, once', () => {
  assert.equal(withRef('refs: []\n', '#1'), 'refs: ["#1"]\n')
  assert.equal(withRef('refs:\n  - "#2"\n', '#3'), 'refs:\n  - "#3"\n  - "#2"\n')
  assert.equal(withRef('id: x\n', '#4'), 'id: x\nrefs: ["#4"]\n')
  assert.equal(withRef('refs: ["#5"]\n', '#5'), 'refs: ["#5"]\n')
})
