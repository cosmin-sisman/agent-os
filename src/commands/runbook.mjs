// `agent-os runbook`: writes docs/runbooks/ (deploy, rollback, restore and the takeover dossier) from the project's
// release flow, CI and stack. Existing runbooks are kept unless --force; facts the repository cannot tell are
// marked "to fill".

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { languageFor } from '../i18n/i18n.mjs'
import { systemGit } from '../workflow/start.mjs'
import { releaseFacts, runbooks } from '../maintenance/runbook.mjs'

export const usage = 'agent-os runbook [--force] [--dry-run]'

export const options = {
  force: { type: 'boolean', description: 'Replace runbooks that already exist' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const { merged } = loadConfig(ctx.cwd)
  const facts = releaseFacts(ctx.cwd, merged, { git: ctx.io.git ?? systemGit(ctx.cwd) })
  const files = runbooks(facts, { lang: languageFor(merged, 'docs') })
  const rows = Object.entries(files).map(([path, text]) => {
    const exists = existsSync(join(ctx.cwd, path))
    const action = exists && !ctx.values.force ? 'kept' : exists ? 'replaced' : 'written'
    if (action !== 'kept' && !ctx.dryRun) { mkdirSync(dirname(join(ctx.cwd, path)), { recursive: true }); writeFileSync(join(ctx.cwd, path), text) }
    return { path, action, toFill: (text.match(/_(to fill|de completat): /g) ?? []).length }
  })
  ctx.output({ dryRun: ctx.dryRun, facts, files: rows }, [...rows.map((r) => `${ctx.dryRun && r.action !== 'kept' ? `would be ${r.action}` : r.action} ${r.path}${r.action !== 'kept' && r.toFill ? ` (${r.toFill} fact(s) to fill)` : r.action === 'kept' ? ' (exists: --force replaces it)' : ''}`), '', 'fill in what the repository cannot tell, then walk them with agent-os security exercise'].join('\n'))
  return EXIT.OK
}
