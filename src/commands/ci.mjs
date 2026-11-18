// `agent-os ci`: the CI reviewer behind /ci. `review` reads the repository's workflows (or the files named) and lists
// what best practice asks for; errors fail (exit 1), warnings and notes do not. `checklist` prints the rules /ci
// writes by. It only reads: fixing a workflow is a change like any other.

import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { CliError, EXIT } from '../cli/errors.mjs'
import { RULES, ciFiles, reviewRepo } from '../ci/review.mjs'

export const usage = 'agent-os ci review [<file>…] [--strict] [--json]   ·   checklist'

export const options = {
  strict: { type: 'boolean', description: 'review: warnings fail too' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action, ...files] = ctx.positionals
  if (action === 'checklist') {
    const rows = Object.entries(RULES).map(([id, r]) => ({ id, ...r }))
    ctx.output(rows, rows.map((r) => `- [${r.level}] ${r.text} (${r.id})`).join('\n'))
    return EXIT.OK
  }
  if (action !== 'review') throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
  for (const f of files) if (!existsSync(resolve(ctx.cwd, f))) throw new CliError(`${f} does not exist`)
  const list = files.length ? files : ciFiles(ctx.cwd)
  if (!list.length) { ctx.output({ files: [], findings: [], summary: { error: 0, warn: 0, info: 0 } }, 'no CI files found (.github/workflows/*.yml, .gitlab-ci.yml, .gitlab/*.yml)'); return EXIT.OK }
  const r = reviewRepo(ctx.cwd, list)
  const order = { error: 0, warn: 1, info: 2 }
  const text = [...r.findings].sort((a, b) => order[a.level] - order[b.level] || a.file.localeCompare(b.file)).map((f) => `${f.level.padEnd(5)} ${f.file} ${f.where}: ${f.message} (${f.rule})`)
  ctx.output(r, `${text.length ? `${text.join('\n')}\n\n` : ''}${r.files.length} file(s): ${r.summary.error} error(s), ${r.summary.warn} warning(s), ${r.summary.info} note(s)`)
  return r.summary.error || (ctx.values.strict && r.summary.warn) ? EXIT.CHECK_FAILED : EXIT.OK
}
