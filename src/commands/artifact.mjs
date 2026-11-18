// `agent-os artifact`: new (scaffold artifacts/<date>-<slug>/ for a type), list (with problems and stale sources),
// check (validate every artifact.yaml), log (an artifact's git history), build (a page from its template and sources)
// and verify (stale when a source changed). link and publish come later.

import { CliError, EXIT } from '../cli/errors.mjs'
import { TYPES, KINDS, artifactLog, listArtifacts, newArtifact } from '../artifacts/artifact.mjs'
import { buildArtifact, verifyArtifacts } from '../artifacts/build.mjs'
import { buildSite, webUrlOf } from '../artifacts/site.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'
import { loadConfig } from '../config/config.mjs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { systemGit } from '../workflow/start.mjs'
import { ghClient } from '../tracker/gh.mjs'

export const usage = [
  `agent-os artifact new <${TYPES.join('|')}> <slug> [--title <t>] [--kind ${KINDS.join('|')}] [--author <login>…] [--ref <#N>…] [--dry-run]`,
  'agent-os artifact list [--type <type>]   ·   check   ·   log <id>',
  'agent-os artifact build <id> | --living [--dry-run]   ·   verify [<id>] [--strict]   ·   site [<out>] [--strict]',
].join('\n       ')

export const options = {
  title: { type: 'string', description: 'new: the title (default: from the slug)' },
  kind: { type: 'string', description: `new: ${KINDS.join(' or ')} (default: living for stack-map and dashboard, else snapshot)` },
  author: { type: 'string', multiple: true, description: 'new: an author login (default: your platform login)' },
  ref: { type: 'string', multiple: true, description: 'new: an issue, PR or decision it belongs to' },
  type: { type: 'string', description: 'list: only this type' },
  living: { type: 'boolean', description: 'build: every living artifact made from a template (what CI rebuilds)' },
  strict: { type: 'boolean', description: 'verify, site: exit 1 when an artifact is stale' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action, a, b] = ctx.positionals
  const v = ctx.values
  switch (action) {
    case 'new': {
      if (!a || !b) throw new CliError('new needs a type and a slug', { hint: `usage: ${usage}` })
      let authors = v.author ?? []
      if (!authors.length) { try { const me = ghClient(ctx.io.gh).rest('GET', 'user')?.login; if (me) authors = [me] } catch { /* no login: no author */ } }
      const r = newArtifact(ctx.cwd, { type: a, slug: b, title: v.title, kind: v.kind, authors, refs: v.ref ?? [], now: ctx.io.now ?? new Date(), dryRun: ctx.dryRun })
      ctx.output(r, `${r.dryRun ? 'would create' : 'created'} ${r.folder}/ (${r.type}, ${r.kind}, draft): ${r.files.map((f) => f.split('/').pop()).join(', ')}. Fill in the page and the summary; status current when it is ready.`)
      return EXIT.OK
    }
    case 'list':
    case 'check': {
      const all = listArtifacts(ctx.cwd).filter((x) => !v.type || x.type === v.type)
      const bad = all.filter((x) => x.problems.length)
      if (action === 'check') {
        ctx.output({ artifacts: all.length, problems: bad.map((x) => ({ folder: x.folder, problems: x.problems })) }, bad.length ? bad.map((x) => `artifacts/${x.folder}:\n  - ${x.problems.join('\n  - ')}`).join('\n') : `${all.length} artifact(s), all valid`)
        return bad.length ? EXIT.CHECK_FAILED : EXIT.OK
      }
      const rows = all.map(({ id, title, type, kind, status, refs, problems, stale }) => ({ id, title, type, kind, status, refs: refs ?? [], problems, stale }))
      ctx.output(rows, rows.length ? rows.map((x) => `${x.id}  ${x.type ?? '?'}  ${x.kind ?? '?'}  ${x.status ?? '?'}${x.stale.length ? `  stale (${x.stale.length} source(s) changed)` : ''}${x.problems.length ? `  ${x.problems.length} problem(s)` : ''}\n  ${x.title ?? ''}`).join('\n') : 'no artifacts yet: agent-os artifact new <type> <slug>')
      return EXIT.OK
    }
    case 'log': {
      if (!a) throw new CliError('which artifact?', { hint: 'agent-os artifact list' })
      if (!listArtifacts(ctx.cwd).some((x) => x.folder === a)) throw new CliError(`no artifact "${a}"`, { hint: 'agent-os artifact list' })
      const entries = artifactLog(ctx.io.git ?? systemGit(ctx.cwd), a)
      ctx.output(entries, entries.length ? entries.map((e) => `${e.commit}  ${e.date}  ${e.author}  ${e.subject}`).join('\n') : `${a} has no commits yet`)
      return EXIT.OK
    }
    case 'build': {
      const ids = v.living ? listArtifacts(ctx.cwd).filter((x) => x.kind === 'living' && existsSync(join(ctx.cwd, 'artifacts', x.folder, 'template.html'))).map((x) => x.folder) : [a]
      if (!ids[0]) throw new CliError('which artifact?', { hint: 'agent-os artifact build <id>, or --living for every living one' })
      const built = ids.map((id) => buildArtifact(ctx.cwd, id, { dryRun: ctx.dryRun }))
      ctx.output(built, built.length ? built.map((r) => `${r.dryRun ? 'would build' : 'built'} ${r.id}: ${r.bytes} bytes${r.changed ? '' : ' (unchanged)'}, ${r.sources.length} source hash(es) recorded`).join('\n') : 'no living artifact is built from a template')
      return EXIT.OK
    }
    case 'verify': {
      const r = verifyArtifacts(ctx.cwd, { id: a })
      const lines = r.artifacts.map((x) => `${x.id}  ${x.kind ?? '?'}  ${x.stale.length ? `STALE: ${x.stale.join(', ')} changed; ${x.buildable ? `agent-os artifact build ${x.id}` : 'update the page and its source hashes'}${x.kind === 'snapshot' ? ' (a snapshot: a new date is a new artifact)' : ''}` : 'sources verified'}`)
      ctx.output(r, lines.join('\n') || 'no artifacts')
      return v.strict && !r.ok ? EXIT.CHECK_FAILED : EXIT.OK
    }
    case 'site': {
      const { merged } = loadConfig(ctx.cwd)
      const out = a ?? '.agent-os/cache/site'
      if (ctx.dryRun) { const all = listArtifacts(ctx.cwd); ctx.output({ dryRun: true, out, artifacts: all.length }, `would build the site into ${out}/ with ${all.length} artifact(s)`); return EXIT.OK }
      const r = buildSite(ctx.cwd, out, { title: merged.platform?.project ? `${merged.platform.project} artifacts` : 'Artifacts', webUrl: webUrlOf(merged), vocab: vocabularyFor(merged.platform?.type) })
      const stale = r.items.filter((x) => x.stale.length)
      ctx.output({ out, artifacts: r.items.map((x) => x.folder), stale: stale.map((x) => x.folder), skipped: r.skipped }, `site: ${r.items.length} artifact(s), ${stale.length} stale${r.skipped.length ? `, ${r.skipped.length} skipped for invalid metadata (${r.skipped.join(', ')})` : ''} → ${out}/`)
      return v.strict && (stale.length || r.skipped.length) ? EXIT.CHECK_FAILED : EXIT.OK
    }
    default: throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
  }
}
