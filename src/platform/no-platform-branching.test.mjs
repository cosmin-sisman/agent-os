// Architecture rule (#91): commands and skill templates decide by capabilities, never by the platform's name. Only the
// modules that are about platforms may look at platform.type: src/platform, src/config, the tracker factory, the env
// check (which CLI to call) and the platform command itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const ALLOWED = ['src/platform/', 'src/config/', 'src/tracker/tracker.mjs', 'src/env/checks.mjs', 'src/commands/platform.mjs']
const NAME_CHECK = /platform\??\.type\s*(===?|!==?)|(===?|!==?)\s*['"](github|gitlab)['"]|\{\{#if\s+platform\.type/

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? (name === '__fixtures__' ? [] : files(full)) : [full]
  })
}

test('no command, module or skill template branches on the platform name outside the platform modules', () => {
  const offenders = []
  for (const file of [...files(join(root, 'src')), ...files(join(root, 'templates'))]) {
    const rel = relative(root, file).split(sep).join('/')
    if (/\.test\.mjs$/.test(rel) || ALLOWED.some((a) => rel.startsWith(a))) continue
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => { if (NAME_CHECK.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`) })
  }
  assert.deepEqual(offenders, [], 'decide with has(caps, …) or a plan…() helper from src/platform/capabilities.mjs')
})
