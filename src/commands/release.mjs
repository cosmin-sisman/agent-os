// `agent-os release`: plan (read only), open (the release branch and change request), finish (merge commit, tag,
// platform release, milestone roll, release checks, sync back), and notes. Every step is safe to rerun.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'
import { changelogEntry, notesMarkdown, releaseNotes } from '../release/notes.mjs'
import { finishRelease, openRelease, planRelease } from '../release/release.mjs'
import { systemProbe } from '../env/probe.mjs'
import { ghClient } from '../tracker/gh.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { parse, stringify } from '../yaml/yaml.mjs'
import { systemGit } from '../workflow/start.mjs'

export const usage = [
  'agent-os release plan --version <x.y.z> [--hotfix]',
  'agent-os release open --version <x.y.z> [--dry-run]',
  'agent-os release finish --version <x.y.z> [--hotfix] [--accept <risk id>…] [--dry-run]',
  'agent-os release notes --from <tag or commit> [--to <ref>] --version <x.y.z> [--changelog] [--dry-run]',
].join('\n       ')

export const options = {
  from: { type: 'string', description: 'notes: the previous release (tag or commit)' },
  to: { type: 'string', description: 'notes: the end of the range (default HEAD)' },
  version: { type: 'string', description: 'notes: the version being released' },
  changelog: { type: 'boolean', description: 'notes: also add the entry to changelog.yaml (read by update --plan)' },
  hotfix: { type: 'boolean', description: 'plan/finish: release what is on the production branch (a hotfix), then sync it back' },
  accept: { type: 'string', multiple: true, description: 'finish: accept a risk the plan found (destructive:<file>, env:<NAME>, or a kind)' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action] = ctx.positionals
  if (['plan', 'open', 'finish'].includes(action)) return flow(ctx, action)
  if (action !== 'notes') throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
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

async function flow(ctx, action) {
  const v = ctx.values
  const { merged } = loadConfig(ctx.cwd)
  const vocab = vocabularyFor(merged.platform?.type)
  const deps = { git: ctx.io.git ?? systemGit(ctx.cwd), tracker: ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab }), cwd: ctx.cwd, config: merged, vocab }
  if (action === 'plan') {
    const p = planRelease(deps, { version: v.version, hotfix: v.hotfix })
    ctx.output(p, [`release ${p.tag}${p.hotfix ? ' (hotfix)' : ''}: ${p.lastTag ?? 'first release'} → ${p.head}${p.tagged ? ' (already tagged)' : ''}`, `title: ${p.title}`, '', notesMarkdown(p.notes, vocab), '', ...(p.inbox ? [`${p.inbox} lesson(s) wait in the inbox: run /retro before finishing the release.`, ''] : []), p.risks.length ? `Risks to accept before finishing:\n${p.risks.map((r) => `  ${r.id}: ${r.detail}`).join('\n')}` : 'No risks found.', ...(p.warnings?.length ? ['', 'Package:', ...p.warnings.map((x) => `  - ${x}`)] : []), ...(p.problems.length ? ['', 'Problems:', ...p.problems.map((x) => `  - ${x}`)] : [])].join('\n'))
    return p.problems.length ? EXIT.CHECK_FAILED : EXIT.OK
  }
  if (action === 'open') {
    let author = 'agent-os'
    try { author = ghClient(ctx.io.gh).rest('GET', 'user')?.login ?? author } catch { /* default */ }
    const r = openRelease(deps, { version: v.version, author, now: ctx.io.now ?? new Date(), dryRun: ctx.dryRun })
    if (r.problems) { ctx.output(r, `not opened:\n${r.problems.map((p) => `  - ${p}`).join('\n')}`); return EXIT.CHECK_FAILED }
    ctx.output(r, r.dryRun ? `would:\n${r.steps.map((s) => `  ${s}`).join('\n')}` : [`${r.updated ? 'updated' : 'opened'} ${vocab.cr} ${vocab.crRef}${r.changeRequest.number}: ${r.changeRequest.url ?? ''}`, ...(r.conflicts ? [`it CONFLICTS with ${merged.branches.production}: the platform runs no checks on it until the conflicts are resolved. Merge origin/${merged.branches.production} into ${r.plan.branch}, resolve, push, then run release open again`] : [])].join('\n'))
    if (r.conflicts) return EXIT.CHECK_FAILED
    return EXIT.OK
  }
  const r = finishRelease(deps, { version: v.version, hotfix: v.hotfix, accept: v.accept ?? [], now: ctx.io.now ?? new Date(), probe: ctx.io.probe ?? systemProbe(ctx.io.env), exec: ctx.io.exec, dryRun: ctx.dryRun })
  if (!r.released) {
    ctx.output(r, [r.dryRun && !r.problems.length ? 'would:' : 'not released yet:', ...(r.problems.length ? r.problems.map((p) => `  - ${p}`) : r.steps.map((s) => `  ${s}`))].join('\n'))
    return r.problems.length ? EXIT.CHECK_FAILED : EXIT.OK
  }
  const failed = r.checks.suites.filter((s) => !s.passed)
  ctx.output(r, [`released ${r.plan.tag} (${r.sha.slice(0, 7)})${r.release.url ? `: ${r.release.url}` : ''}`, !r.milestone.opened ? '  milestones: left as they are (milestones.rolling is off)' : r.milestone.closed ? `  milestone: closed "${r.milestone.closed}", opened "${r.milestone.opened}"` : `  milestone: "${r.milestone.opened}" is open`, `  checks: environment ${r.checks.env.fail ? 'failed' : 'ok'}${r.checks.suites.length ? `, ${r.checks.suites.map((s) => `${s.name} ${s.passed ? 'passed' : 'FAILED'}`).join(', ')}` : ''}`, `  sync into ${merged.branches.integration}: ${vocab.crRef}${r.sync.number}${r.sync.existed ? ' (already open)' : ''}`].join('\n'))
  return failed.length || r.checks.env.fail ? EXIT.CHECK_FAILED : EXIT.OK
}
