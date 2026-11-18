// The update flow (design §19): a read-only plan, then the update on its own branch, opened as a change request.
// Git is the backup: nothing happens on the integration or default branch, and rolling back means closing the PR.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CliError } from '../cli/errors.mjs'
import { loadConfig, saveJson, TEAM_FILE } from '../config/config.mjs'
import { satisfies } from '../env/semver.mjs'
import { resultsTable, runGate } from '../gate/gate.mjs'
import { addEntry } from '../journal/journal.mjs'
import { deprecatedInUse } from '../lifecycle/manifest.mjs'
import { installRoutes } from '../managed/install.mjs'
import { readHooks } from '../managed/managed.mjs'
import { compareVersions, listMigrations, MIGRATIONS_DIR, pendingMigrations, runMigrations } from '../migrations/runner.mjs'
import { parse } from '../yaml/yaml.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const GROUPS = ['breaking', 'new', 'deprecated', 'legacy', 'removed', 'fix', 'chore']
const TITLES = { breaking: 'Breaking', new: 'New', deprecated: 'Deprecated', legacy: 'Legacy', removed: 'Removed', fix: 'Fixes', chore: 'Chore' }

/** The package's own release data: version, manifest, changelog, engines. */
export function packageRelease(root = ROOT) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const read = (f, fallback) => { try { return readFileSync(join(root, f), 'utf8') } catch { return fallback } }
  return {
    version: pkg.version,
    node: pkg.engines?.node ?? null,
    claudeCode: pkg.agentOs?.claudeCode ?? null,
    manifest: JSON.parse(read('manifest.json', '{"items":{}}')),
    changelog: parse(read('changelog.yaml', 'releases: []'))?.releases ?? [],
  }
}

const isPre = (v) => /-/.test(String(v))
const between = (v, from, to) => (!from || compareVersions(v, from) > 0) && compareVersions(v, to) <= 0

/** The changes between two versions, grouped: changelog entries plus lifecycle changes from the manifest. */
export function groupedChanges({ from, to, changelog, manifest }) {
  const groups = Object.fromEntries(GROUPS.map((g) => [g, []]))
  for (const r of changelog) {
    if (!between(r.version, from, to)) continue
    for (const c of r.changes ?? []) (groups[GROUPS.includes(c.group) ? c.group : 'chore']).push({ version: r.version, text: c.text, refs: c.refs ?? [], migration: c.migration ?? null })
  }
  for (const [id, e] of Object.entries(manifest.items ?? {})) {
    if (e.status === 'new' && e.since && between(e.since, from, to)) groups.new.push({ version: e.since, text: id, item: true })
    if (e.status === 'deprecated' && e.deprecatedIn && between(e.deprecatedIn, from, to)) groups.deprecated.push({ version: e.deprecatedIn, text: `${id}${e.replacement ? ` → ${e.replacement}` : ''}${e.removeIn ? ` (removed in ${e.removeIn})` : ''}`, item: true })
    if (e.status === 'legacy' && e.legacyIn && between(e.legacyIn, from, to)) groups.legacy.push({ version: e.legacyIn, text: id, item: true })
    if (e.status === 'removed' && e.removedIn && between(e.removedIn, from, to)) groups.removed.push({ version: e.removedIn, text: `${id}${e.migration ? ` (migration ${e.migration})` : ''}`, item: true })
  }
  return groups
}

/**
 * The read-only plan: grouped changes, the files that would change, local edits that merge or conflict, the
 * migrations, and the deprecated items this project still uses.
 */
export async function planUpdate(cwd, { release = packageRelease(), templatesRoot, migrationsDir = MIGRATIONS_DIR, channel = 'latest' } = {}) {
  const { team, local, merged } = loadConfig(cwd)
  const from = merged.version ?? null
  const to = release.version
  const problems = []
  if (isPre(to) && channel !== 'next') problems.push(`${to} is a pre-release: pass --channel next to try it (the pin stays ${from ?? 'unset'})`)
  if (from && compareVersions(to, from) < 0) problems.push(`${to} is older than the pinned ${from}: run the update with the version you want (npx -y @cosmin-sisman/agent-os@<version> update)`)
  const target = { ...merged, version: channel === 'next' ? from : to }
  const files = installRoutes(cwd, target, { version: to, dryRun: true, templatesRoot }).results.filter((r) => r.action !== 'unchanged')
  const migrations = pendingMigrations(from, to, listMigrations(migrationsDir))
  let settings = {}
  try { settings = JSON.parse(readFileSync(join(cwd, '.claude', 'settings.json'), 'utf8')) } catch { /* none */ }
  const hookCommands = Object.values(JSON.parse(readHooks(settings))).flat().flatMap((g) => (g.hooks ?? []).map((h) => h.command ?? '')).filter(Boolean)
  return {
    from, to, channel, upToDate: from === to && !files.length, problems,
    groups: groupedChanges({ from, to, changelog: release.changelog, manifest: release.manifest }),
    files, conflicts: files.filter((f) => f.action === 'conflict'), merges: files.filter((f) => f.action === 'merged'),
    migrations, deprecated: deprecatedInUse(release.manifest, { team: team ?? {}, local: local ?? {}, hookCommands }),
  }
}

/** The plan as Markdown, for the terminal and the change request body. */
export function planMarkdown(plan) {
  const out = [`agent-os ${plan.from ?? '(unpinned)'} → ${plan.to}${plan.channel === 'next' ? ' (channel next: the pin is not changed)' : ''}`, '']
  for (const g of GROUPS) {
    const list = plan.groups[g]
    if (!list.length) continue
    out.push(`### ${TITLES[g]}`, '', ...list.map((c) => `- ${c.text}${c.refs?.length ? ` (${c.refs.join(', ')})` : ''} _(${c.version})_`), '')
  }
  if (!GROUPS.some((g) => plan.groups[g].length)) out.push('_No changelog entries between these versions._', '')
  out.push('### Files', '', ...(plan.files.length ? plan.files.map((f) => `- \`${f.key}\`: ${f.action}${f.rej ? ` → \`${f.rej}\`` : ''}`) : ['_No managed file changes._']), '')
  out.push('### Migrations', '', ...(plan.migrations.length ? plan.migrations.map((m) => `- ${m}`) : ['_None._']), '')
  if (plan.deprecated.length) out.push('### Deprecated items this project still uses', '', ...plan.deprecated.map((d) => `- ${d.message}`), '')
  return out.join('\n').trimEnd()
}

const ok = (r) => r.status === 0
const must = (git, args, what) => {
  const r = git(args)
  if (!ok(r)) throw new CliError(`${what ?? `git ${args.join(' ')}`} failed: ${(r.stderr || r.stdout).trim().split('\n')[0]}`)
  return r.stdout.trim()
}

/**
 * Preflight: a clean tree, the minimum Node and Claude Code versions, no problems in the plan.
 * @param {{ git: Function, probe?: object }} deps
 */
export function preflight(plan, { git, release, nodeVersion = process.versions.node, claudeVersion = null }) {
  const problems = [...plan.problems]
  const status = git(['status', '--porcelain'])
  if (!ok(status)) problems.push('this is not a git repository')
  else if (status.stdout.trim()) problems.push('the working tree has uncommitted changes: commit or stash them first')
  if (release.node && !satisfies(nodeVersion.split('.').map(Number), release.node)) problems.push(`agent-os ${plan.to} needs Node ${release.node}; this is ${nodeVersion}`)
  if (release.claudeCode && claudeVersion && !satisfies(claudeVersion.split('.').map(Number), release.claudeCode)) problems.push(`agent-os ${plan.to} needs Claude Code ${release.claudeCode}; this is ${claudeVersion}`)
  return problems
}

/**
 * The update: branch chore/agent-os-<version> from origin/<integration>, migrations, managed files, journal entry,
 * commit, gate, push and a change request with the plan and the results. Returns to the branch it started on.
 * @param {{ git: Function, tracker?: object, exec?: Function, vocab: object }} deps
 */
export async function runUpdate(cwd, deps, { release = packageRelease(), templatesRoot, migrationsDir = MIGRATIONS_DIR, channel = 'latest', author, open = true, claudeVersion = null, now = new Date() } = {}) {
  const { git, tracker, exec, vocab } = deps
  const plan = await planUpdate(cwd, { release, templatesRoot, migrationsDir, channel })
  if (plan.upToDate) return { updated: false, upToDate: true, plan }
  const problems = preflight(plan, { git, release, claudeVersion })
  if (problems.length) return { updated: false, problems, plan }
  const { merged, team } = loadConfig(cwd)
  const base = merged.branches.integration
  const branch = `chore/agent-os-${plan.to}`
  const start = must(git, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (ok(git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]))) throw new CliError(`the branch ${branch} already exists`, { hint: `an update to ${plan.to} is already in progress: open its change request, or delete the branch to start over` })
  must(git, ['fetch', 'origin', base])
  must(git, ['switch', '-c', branch, `origin/${base}`])
  let committed = false
  try {
    const log = await runMigrations(cwd, { from: plan.from, to: plan.to, dir: migrationsDir })
    if (channel !== 'next') saveJson(cwd, TEAM_FILE, { ...loadConfig(cwd).team, version: plan.to })
    const config = loadConfig(cwd).merged
    const applied = installRoutes(cwd, config, { version: plan.to, templatesRoot }).results.filter((r) => r.action !== 'unchanged')
    const conflicts = applied.filter((r) => r.action === 'conflict')
    const entry = addEntry(cwd, {
      type: 'release', title: `agent-os ${plan.to}`, areas: ['agent-os'], refs: [], author: author ?? 'agent-os', at: now,
      body: `Updated agent-os from ${plan.from ?? 'an unpinned version'} to ${plan.to}${channel === 'next' ? ' (channel next; the pin is unchanged)' : ''}.\n\n- Migrations: ${log.length ? log.map((m) => m.version).join(', ') : 'none'}\n- Files: ${applied.length} changed, ${conflicts.length} conflict(s)${conflicts.length ? `: ${conflicts.map((c) => c.rej).join(', ')}` : ''}`,
    })
    if (entry.problems) throw new CliError(`journal entry: ${entry.problems.join('; ')}`)
    must(git, ['add', '-A'])
    must(git, ['commit', '-m', `chore(agent-os): update to ${plan.to}\n\nPlan, migrations and conflicts are in the change request.`])
    committed = true
    const gate = runGate({ config, git, cwd, exec })
    const body = [
      `## What\n\nUpdates agent-os from ${plan.from ?? '(unpinned)'} to ${plan.to}. Generated by \`agent-os update\`. To roll back, close this ${vocab.changeRequest}.`,
      `## Plan\n\n${planMarkdown(plan)}`,
      `## Migration log\n\n${log.length ? log.map((m) => `- **${m.version}** ${m.description}${m.changes.length ? `\n${m.changes.map((c) => `  - ${c}`).join('\n')}` : ''}`).join('\n') : '_No migrations ran._'}`,
      `## Conflicts\n\n${conflicts.length ? `Local edits that could not be merged. The local files are unchanged; resolve each \`.rej\` by hand, then delete it:\n\n${conflicts.map((c) => `- [ ] \`${c.rej}\` (for \`${c.key}\`)`).join('\n')}` : '_None._'}`,
      `## How it was tested\n\n${resultsTable(gate)}${gate.warnings.length ? `\n\n${gate.warnings.map((w) => `- ${w}`).join('\n')}` : ''}`,
      `## Lessons\n\nNone: an automated update; read the plan above, especially Breaking and Deprecated.`,
      ...(conflicts.length ? [`## Before merge\n\n- [ ] every \`.rej\` file above is resolved and deleted`] : []),
    ].join('\n\n')
    let cr = null
    if (open && tracker) {
      must(git, ['push', '-u', 'origin', branch], 'git push')
      cr = (typeof tracker === 'function' ? tracker() : tracker).createPullRequest({ title: `chore(agent-os): update to ${plan.to}`, body, head: branch, base, draft: conflicts.length > 0 || !gate.ok })
    }
    return { updated: true, branch, plan, migrations: log, files: applied, conflicts, gate: { ok: gate.ok, suites: gate.suites.map((s) => ({ name: s.name, passed: s.passed })) }, changeRequest: cr, body, team: team ?? null }
  } finally {
    // Back to where the person was; after a failure before the commit, stay on the branch so it can be inspected.
    if (committed) git(['switch', start])
  }
}
