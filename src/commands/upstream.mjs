// `agent-os upstream`: draft an improvement for the public agent-os repository from a statement or a lesson, filtered
// for privacy; search for it upstream; file it only with --file --approve after the person has read the exact text.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { addEntry } from '../journal/journal.mjs'
import { readLessons } from '../lessons/lessons.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { runningVersion } from '../version/pin.mjs'
import { UPSTREAM_REPO, assertApproved, draftUpstream, saveDraft, upstreamDuplicates } from '../upstream/upstream.mjs'

export const usage = 'agent-os upstream draft (--title "<t>" --what "<text>" | --lesson <id>) [--proposal "<p>"] [--where "/skill|agent-os cmd"] [--key <config.key>…] [--kind feature|bug] [--file --approve [--new]]'

export const options = {
  title: { type: 'string', description: 'The improvement in one line' },
  what: { type: 'string', description: 'What happened or what is missing' },
  proposal: { type: 'string', description: 'What agent-os should do instead' },
  where: { type: 'string', description: 'The skill (/pr) or command (agent-os gate) involved' },
  key: { type: 'string', multiple: true, description: 'A configuration key involved (names only, never values)' },
  kind: { type: 'string', description: 'feature (default) or bug' },
  lesson: { type: 'string', description: 'Draft from a lesson card (its text, filtered)' },
  file: { type: 'boolean', description: 'Send it upstream (needs --approve)' },
  approve: { type: 'boolean', description: 'The person has read the exact text and agrees' },
  new: { type: 'boolean', description: 'File it even though a similar upstream issue exists' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action] = ctx.positionals
  if (action !== 'draft') throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
  const v = ctx.values
  const { merged } = loadConfig(ctx.cwd)
  let input = { title: v.title, what: v.what, proposal: v.proposal, where: v.where, configKeys: v.key ?? [], kind: v.kind === 'bug' ? 'bug' : 'feature' }
  let card = null
  if (v.lesson) {
    card = readLessons(ctx.cwd).find((c) => c.id === v.lesson || c.id.endsWith(v.lesson))
    if (!card) throw new CliError(`no lesson "${v.lesson}"`, { hint: 'agent-os lessons search <words>' })
    input = { ...input, title: input.title ?? card.text, what: input.what ?? card.body }
  }
  if (!input.title || !input.what) throw new CliError('a title and what happened are required (--title, --what, or --lesson)')
  const draft = draftUpstream(input, { cwd: ctx.cwd, config: merged, version: ctx.io.running ?? runningVersion() })
  const removed = Object.entries(draft.removed).map(([k, n]) => `${n} ${k}`).join(', ')
  const upstream = ctx.io.upstreamTracker ?? (() => { try { return createTracker({ platform: { type: 'github', project: UPSTREAM_REPO } }, { gh: ctx.io.gh }) } catch { return null } })()
  let dup = { query: '', matches: [] }
  const enabled = merged.upstream?.enabled ?? !merged.platform?.host
  if (enabled && upstream) { try { dup = upstreamDuplicates(upstream, draft) } catch { dup = { query: '', matches: [], failed: true } } }
  const shown = [`Title: ${draft.title}`, `Labels: ${draft.labels.join(', ')}`, '', draft.body, '', removed ? `Removed before showing it: ${removed}.` : 'Nothing private was found to remove.', ...(dup.matches.length ? ['', 'Similar upstream issues (react with 👍 or comment there instead of filing a new one):', ...dup.matches.map((m) => `  #${m.number} ${m.title} (${m.state}) ${m.url}`)] : [])]
  if (!enabled) {
    const file = ctx.dryRun ? null : saveDraft(ctx.cwd, draft)
    ctx.output({ draft, saved: file, removed: draft.removed }, `${shown.join('\n')}\n\n${merged.upstream?.enabled === false ? 'upstream.enabled is false' : 'upstream is off by default on a self-managed host (upstream.enabled: true turns it on)'}: ${file ? `the draft is in ${file}` : 'the draft would be saved locally'}; nothing is sent.`)
    return EXIT.OK
  }
  if (!v.file || ctx.dryRun) {
    ctx.output({ draft, duplicates: dup.matches, removed: draft.removed }, `${shown.join('\n')}\n\nThis is the exact text. To send it: agent-os upstream draft … --file --approve`)
    return EXIT.OK
  }
  assertApproved(v.approve)
  if (dup.matches.length && !v.new) throw new CliError(`a similar upstream issue exists: #${dup.matches[0].number} ${dup.matches[0].title}`, { hint: 'comment or react there; or pass --new if it is really different' })
  const r = upstream.create({ title: draft.title, body: draft.body, labels: draft.labels })
  addEntry(ctx.cwd, { type: 'note', title: `Upstream: ${draft.title}`.slice(0, 120), areas: ['upstream'], refs: [], author: (() => { try { return upstream.whoami() ?? 'agent-os' } catch { return 'agent-os' } })(), body: `Filed ${r.url}.` })
  if (card) { const p = join(ctx.cwd, card.path); writeFileSync(p, readFileSync(p, 'utf8').replace(/^---\r?\n/, `---\nupstream: "${r.url}"\n`)) }
  ctx.output({ filed: r, draft }, `filed ${r.url}${card ? `; recorded on ${card.path}` : ''}`)
  return EXIT.OK
}
