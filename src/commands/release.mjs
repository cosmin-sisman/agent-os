// `agent-os release`: release notes today (#70); the release flow itself (release change request, tag, platform
// release, milestone roll) is #17. Nothing here publishes anything.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'
import { changelogEntry, notesMarkdown, releaseNotes } from '../release/notes.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { parse, stringify } from '../yaml/yaml.mjs'
import { systemGit } from '../workflow/start.mjs'

export const usage = 'agent-os release notes --from <tag or commit> [--to <ref>] --version <x.y.z> [--changelog] [--dry-run]'

export const options = {
  from: { type: 'string', description: 'notes: the previous release (tag or commit)' },
  to: { type: 'string', description: 'notes: the end of the range (default HEAD)' },
  version: { type: 'string', description: 'notes: the version being released' },
  changelog: { type: 'boolean', description: 'notes: also add the entry to changelog.yaml (read by update --plan)' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action] = ctx.positionals
  if (action !== 'notes') throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage} (the release flow itself is #17)` })
  const v = ctx.values
  if (!v.from) throw new CliError('--from is required: the previous release tag or commit')
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v.version ?? '')) throw new CliError('--version is required, as x.y.z')
  const { merged } = loadConfig(ctx.cwd)
  const vocab = vocabularyFor(merged.platform?.type)
  const tracker = ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })
  const notes = releaseNotes({ git: ctx.io.git ?? systemGit(ctx.cwd), tracker, cwd: ctx.cwd, vocab }, { from: v.from, to: v.to ?? 'HEAD', version: v.version })
  for (const p of notes.problems) ctx.io.stderr(`agent-os: problem: ${p}\n`)
  const markdown = notesMarkdown(notes, vocab)
  let wrote = null
  if (v.changelog && !notes.problems.length) {
    const entry = changelogEntry(notes, { date: (ctx.io.now ?? new Date()).toISOString().slice(0, 10) })
    const file = join(ctx.cwd, 'changelog.yaml')
    let text = ''
    try { text = readFileSync(file, 'utf8') } catch { /* a new file */ }
    const header = text.split(/\r?\n/).filter((l) => l.startsWith('#')).join('\n')
    const releases = (parse(text || 'releases: []')?.releases ?? []).filter((r) => r.version !== entry.version)
    const next = `${header ? `${header}\n` : ''}${stringify({ releases: [entry, ...releases] })}`
    if (!ctx.dryRun) writeFileSync(file, next)
    wrote = { file: 'changelog.yaml', dryRun: ctx.dryRun, entry }
  }
  ctx.output({ ...notes, markdown, changelog: wrote }, `${markdown}${wrote ? `\n\n${wrote.dryRun ? 'would add' : 'added'} ${entry(wrote)} to changelog.yaml` : ''}${notes.problems.length ? `\n\n${notes.problems.length} problem(s) to fix before releasing (see stderr)` : ''}`)
  return notes.problems.length ? EXIT.CHECK_FAILED : EXIT.OK
}

const entry = (w) => `${w.entry.version} (${w.entry.changes.length} change(s))`
