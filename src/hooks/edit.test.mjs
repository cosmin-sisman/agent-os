// Tests for the on-edit standards reminder: a new TODO without an issue names its line, only what the edit added is
// checked, each reminder comes once per session, it never blocks, and doctor checks the same on changed files.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runEvent } from './runner.mjs'
import { editReminders } from './edit.mjs'
import { nonEnglishComments, todosWithoutIssue } from '../standards/checks.mjs'
import { runDoctor } from '../doctor/doctor.mjs'

const CONFIG = { branches: { integration: 'development', production: 'main' }, languages: {}, contextBudgets: {}, slots: {}, standards: { maxFileLines: 500 } }
function project(files) {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-edit-'))
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(cwd, p, '..'), { recursive: true }); writeFileSync(join(cwd, p), c) }
  return cwd
}

test('given a new TODO without an issue reference, a reminder names the line; it is added context, never a block', async () => {
  const cwd = project({ 'src/a.mjs': '// Module a.\nexport const a = 1\n// TODO: handle retries\n' })
  try {
    const input = { session_id: 's1', tool_name: 'Edit', tool_input: { file_path: join(cwd, 'src/a.mjs'), old_string: 'x', new_string: '// TODO: handle retries' } }
    const out = await runEvent('PostToolUse', input, { config: CONFIG, cwd })
    assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse')
    assert.match(out.hookSpecificOutput.additionalContext, /^agent-os standards \(a reminder, not a block\): src\/a\.mjs:3: a TODO without an issue reference; write TODO\(#N\)/)
    assert.equal(out.hookSpecificOutput.permissionDecision, undefined)
    assert.equal(await runEvent('PostToolUse', input, { config: CONFIG, cwd }), null, 'once per session')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('only what the edit added is checked: an old TODO elsewhere, or TODO(#12), is not reminded', () => {
  const cwd = project({ 'src/a.mjs': '// Module a.\n// TODO: old one\nexport const a = 1\n// TODO(#12): fine\n' })
  try {
    assert.equal(editReminders({ tool_name: 'Edit', tool_input: { file_path: 'src/a.mjs', new_string: '// TODO(#12): fine' } }, { config: CONFIG, cwd }), null)
    assert.equal(editReminders({ tool_name: 'Edit', tool_input: { file_path: 'src/a.mjs', new_string: 'export const a = 1' } }, { config: CONFIG, cwd }), null)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('a new file without a header, a comment not in English, and a file over its size are reminded; ro comments when the team allows them', () => {
  const cwd = project({ 'src/new.py': 'import os\n# calculează totalul\nx = 1\n', 'src/big.mjs': `// Big.\n${'x()\n'.repeat(600)}` })
  try {
    const r = editReminders({ session_id: 's', tool_name: 'Write', tool_input: { file_path: 'src/new.py', content: 'import os\n# calculează totalul\nx = 1\n' } }, { config: CONFIG, cwd })
    assert.match(r, /src\/new\.py has no header/)
    assert.match(r, /src\/new\.py:2: this comment is not in English \("calculează totalul"\)/)
    const ro = editReminders({ session_id: 't', tool_name: 'Write', tool_input: { file_path: 'src/new.py', content: '# calculează totalul' } }, { config: { ...CONFIG, languages: { codeComments: 'ro' } }, cwd })
    assert.doesNotMatch(ro ?? '', /not in English/)
    assert.match(editReminders({ session_id: 'u', tool_name: 'Edit', tool_input: { file_path: 'src/big.mjs', new_string: 'x()' } }, { config: CONFIG, cwd }), /src\/big\.mjs is 602 lines, over the 500-line limit/)
    assert.equal(editReminders({ tool_name: 'Read', tool_input: { file_path: 'src/new.py' } }, { config: CONFIG, cwd }), null)
    assert.equal(editReminders({ tool_name: 'Write', tool_input: { file_path: 'README.md', content: '# TODO' } }, { config: CONFIG, cwd }), null, 'not a code file')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the parts: TODO references and English comments', () => {
  assert.deepEqual(todosWithoutIssue('// TODO fix\n// TODO(#4) ok\n// FIXME !12 ok\n// XXX later').map((t) => t.line), [1, 4])
  assert.deepEqual(nonEnglishComments('// plain\n# niște text\nconst s = "țară"').map((c) => c.line), [2])
})

test('doctor checks the same on the files the branch changes, as warnings', () => {
  const cwd = project({ 'src/a.mjs': '// A.\n// TODO: later\nexport {}\n', 'src/b.mjs': '// B.\nexport {}\n', '.gitignore': '.agent-os/local.json\n.agent-os/cache/\n' })
  try {
    const git = (args) => (args.includes('--diff-filter=AM') ? { status: 0, stdout: 'src/a.mjs\nsrc/b.mjs\n' } : { status: 1, stdout: '' })
    const f = runDoctor({ cwd, config: CONFIG, running: '0.0.0', git }, { offline: true, only: ['standards'] }).checks[0].findings
    assert.deepEqual(f.map((x) => [x.level, x.message]), [['warn', 'src/a.mjs:2: a TODO without an issue reference; write TODO(#N), or open the issue with /ticket']])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
