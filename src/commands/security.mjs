// `agent-os security watch`: the advisories that touch this project's dependencies, ranked, into the cache and, with
// --issue, into the one Security digest issue. Only package names and versions leave the project; --dry-run prints
// exactly the requests and sends none. Off by default on a self-managed host.

import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { languageFor } from '../i18n/i18n.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { inventory } from '../security/packages.mjs'
import { childFetch, plannedRequests, queryAdvisories, watchSettings } from '../security/advisories.mjs'
import { MARKER, TITLE, digestBody, prioritize, saveCache } from '../security/digest.mjs'

export const usage = 'agent-os security watch [--issue] [--dry-run]'

export const options = {
  issue: { type: 'boolean', description: 'watch: create or update the one Security digest issue' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action] = ctx.positionals
  if (action !== 'watch') throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
  const { merged } = loadConfig(ctx.cwd)
  const settings = watchSettings(merged)
  const packages = inventory(ctx.cwd)
  if (ctx.dryRun) {
    const reqs = plannedRequests(packages, settings)
    const lines = reqs.map((r) => `${r.method} ${r.url}${r.body ? `\n${r.body.queries.map((q) => `  ${q.package.ecosystem} ${q.package.name}@${q.version}`).join('\n')}` : ''}`)
    ctx.output({ dryRun: true, enabled: settings.enabled, requests: reqs }, `${settings.enabled ? 'would send' : `would send nothing: ${settings.why}; the requests would be`}:\n${lines.join('\n')}`)
    return EXIT.OK
  }
  if (!settings.enabled) { ctx.output({ enabled: false, why: settings.why }, `advisory watch: ${settings.why}`); return EXIT.OK }
  const fetch = ctx.io.fetch ?? childFetch(merged, ctx.cwd)
  const { vulns } = await queryAdvisories(packages, { fetch, settings })
  const items = prioritize(vulns, packages, { accepted: merged.security?.acceptedRisks ?? [] })
  const at = (ctx.io.now ?? new Date()).toISOString()
  saveCache(ctx.cwd, { at, packages: packages.length, items })
  let issue = null
  if (ctx.values.issue) {
    const tracker = ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })
    const body = digestBody(items, { at: at.slice(0, 10), packages: packages.length, lang: languageFor(merged, 'issues') })
    // The same issue is edited every time: the open one with the title and the marker, else a new one.
    const existing = (tracker.search?.(`"${TITLE}" in:title`) ?? []).find((i) => i.title === TITLE && i.state === 'open' && (i.body ?? '').includes(MARKER))
    if (existing) { tracker.update(existing.number, { body }); issue = { number: existing.number, updated: true } }
    else issue = { ...tracker.create({ title: TITLE, body, labels: ['security'] }), created: true }
  }
  const kev = items.filter((i) => i.kev && !i.accepted)
  ctx.output({ at, packages: packages.length, items, issue }, `${packages.length} package(s), ${items.length} advisor${items.length === 1 ? 'y' : 'ies'}${kev.length ? `, ${kev.length} KNOWN EXPLOITED` : ''}:\n${items.slice(0, 20).map((i) => `  ${i.kev ? 'KEV ' : ''}${i.severity.padEnd(8)} ${i.id} ${i.touched.map((p) => `${p.name}@${p.version}`).join(', ')}${i.accepted ? ' (accepted)' : ''}`).join('\n') || '  none'}${issue ? `\n${issue.created ? 'created' : 'updated'} the Security digest (#${issue.number})` : ''}`)
  return kev.length ? EXIT.CHECK_FAILED : EXIT.OK
}
