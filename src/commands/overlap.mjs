// `agent-os overlap`: open change requests and pushed branches that touch the same files as this branch.

import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { findOverlap, overlapLines } from '../collab/overlap.mjs'
import { changedFiles } from '../gate/gate.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { systemGit } from '../workflow/start.mjs'

export const usage = 'agent-os overlap [--path <p>…] [--base <branch>] [--offline]'

export const options = {
  path: { type: 'string', multiple: true, description: 'Check these paths instead of the branch changes (a folder ends with /)' },
  base: { type: 'string', description: 'Compare against origin/<base> (default: branches.integration)' },
  offline: { type: 'boolean', description: 'Pushed branches only; no platform calls' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const { merged } = loadConfig(ctx.cwd)
  const config = ctx.values.base ? { ...merged, branches: { ...merged.branches, integration: ctx.values.base } } : merged
  const git = ctx.io.git ?? systemGit(ctx.cwd)
  const files = ctx.values.path?.length ? ctx.values.path : changedFiles(git, config.branches.integration)
  if (!files.length) throw new CliError('nothing changed on this branch yet', { hint: 'pass --path <file or folder/> to check specific paths' })
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout?.trim()
  const tracker = ctx.values.offline || !merged.platform?.project ? null : ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })
  const r = findOverlap({ tracker, git, cwd: ctx.cwd, config }, { files, branch })
  for (const w of r.warnings) ctx.io.stderr(`agent-os: warning: ${w}\n`)
  const vocab = vocabularyFor(merged.platform?.type)
  ctx.output(r, r.overlaps.length ? [`${r.overlaps.length} other change(s) touch your files; talk to them before you both go further:`, ...overlapLines(r.overlaps, vocab)].join('\n') : `no open ${vocab.changeRequests} or pushed branches touch your ${r.files.length} file(s)`)
  return EXIT.OK
}
