// `agent-os platform switch` (#98), the plan: what moving a project between GitHub and GitLab changes in the
// repository, so it can be reviewed before anything happens. The platform's own importer moves the issues and change
// requests; agent-os only re-renders its routes and re-links what it wrote.
//
// The plan covers:
// - the managed files of the old route, removed (or listed as conflicts when edited by hand);
// - the new route's files, added, and core files whose text depends on the platform, rewritten;
// - the CI entry point (.gitlab-ci.yml with the includes, when it is missing);
// - the configuration keys that change;
// - the journal references to re-link from the importer's map.
//
// The team's own files under the old route's folders are listed for porting by hand. When the plan is followed, no
// file from the old route remains. Applying it (one branch, one change request) is a later step.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { planInstall } from '../managed/install.mjs'
import { readLock, removeManaged } from '../managed/managed.mjs'

export const PLAN_FILE = '.agent-os/cache/platform-switch.json'
const ROUTE_DIRS = { github: ['.github'], gitlab: ['.gitlab'] }
const PLATFORMS = Object.keys(ROUTE_DIRS)

const walk = (root, dir) => {
  const abs = join(root, dir)
  if (!existsSync(abs)) return []
  return readdirSync(abs).flatMap((e) => (statSync(join(abs, e)).isDirectory() ? walk(root, `${dir}/${e}`) : [`${dir}/${e}`]))
}

/** The journal references the importer's map changes: per entry, each old ref and its new one. */
export function relinkJournal(cwd, map = {}) {
  const dir = join(cwd, '.agent-os/journal')
  const files = walk(cwd, '.agent-os/journal').filter((f) => f.endsWith('.md'))
  const rows = []
  const unmapped = new Set()
  for (const f of files) {
    const text = readFileSync(join(cwd, f), 'utf8')
    const refs = [...new Set(text.match(/(?<![\w/])[#!]\d+\b/g) ?? [])]
    const changes = refs.filter((r) => map[r] && map[r] !== r).map((r) => ({ from: r, to: map[r] }))
    for (const r of refs) if (!map[r]) unmapped.add(r)
    if (changes.length) rows.push({ file: f, changes })
  }
  return { entries: existsSync(dir) ? files.length : 0, relink: rows, unmapped: [...unmapped].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))) }
}

/**
 * The switch plan for a project, from its lock and configuration to the target platform.
 * @param {string} cwd
 * @param {object} config merged configuration
 * @param {{ to: string, project?: string, host?: string, map?: Record<string, string> }} target
 */
export function switchPlan(cwd, config, { to, project, host, map = {} }) {
  if (!PLATFORMS.includes(to)) throw new CliError(`--to must be one of ${PLATFORMS.join(', ')}`)
  const lock = readLock(cwd)
  const from = lock.platform ?? config.platform?.type ?? 'github'
  if (from === to) throw new CliError(`this project is already on ${to}`)
  if (!project) throw new CliError('which project on the new platform?', { hint: `agent-os platform switch --to ${to} --project <group/name> [--host <url>]` })
  const nextConfig = { ...config, platform: { ...(config.platform ?? {}), type: to, project, ...(host ? { host } : {}) } }
  if (to !== 'github') delete nextConfig.platform.board
  if (!host) delete nextConfig.platform.host
  const before = planInstall(config, { cwd })
  const after = planInstall(nextConfig, { cwd })
  const oldKeys = new Map(before.items.map((i) => [i.key, i]))
  const newKeys = new Map(after.items.map((i) => [i.key, i]))
  const gone = [...oldKeys.keys()].filter((k) => !newKeys.has(k) && lock.items[k])
  const removal = removeManaged(cwd, gone, { dryRun: true })
  const add = [...newKeys.keys()].filter((k) => !oldKeys.has(k))
  const rewrite = [...newKeys.keys()].filter((k) => oldKeys.has(k) && oldKeys.get(k).content !== newKeys.get(k).content)
  // The team's own files under the old route's folders: agent-os does not own them, so they are ported by hand.
  const managedPaths = new Set(Object.keys(lock.items).map((k) => k.split('#')[0]))
  const manual = (ROUTE_DIRS[from] ?? []).flatMap((d) => walk(cwd, d)).filter((f) => !managedPaths.has(f)).sort()
  const ci = []
  if (to === 'gitlab') {
    const includes = after.items.filter((i) => /^\.gitlab\/agent-os-[\w-]+\.yml$/.test(i.key)).map((i) => i.key)
    if (existsSync(join(cwd, '.gitlab-ci.yml'))) ci.push({ path: '.gitlab-ci.yml', action: 'edit by hand', why: 'it exists: add the includes to its include: list', includes })
    else ci.push({ path: '.gitlab-ci.yml', action: 'add', content: ['# The CI entry point: the agent-os jobs, included from the files agent-os manages.', 'include:', ...includes.map((p) => `  - local: ${p}`), ''].join('\n'), includes })
  }
  if (to === 'github' && existsSync(join(cwd, '.gitlab-ci.yml'))) ci.push({ path: '.gitlab-ci.yml', action: manual.includes('.gitlab-ci.yml') ? 'port by hand' : 'remove', why: 'GitHub runs .github/workflows/' })
  const configChanges = [
    { key: 'platform.type', from, to },
    { key: 'platform.project', from: config.platform?.project ?? null, to: project },
    ...(host || config.platform?.host ? [{ key: 'platform.host', from: config.platform?.host ?? null, to: host ?? null }] : []),
    ...(config.platform?.board && to !== 'github' ? [{ key: 'platform.board', from: config.platform.board, to: null, why: 'GitHub Projects has no GitLab equivalent here; GitLab boards follow labels' }] : []),
  ]
  const journal = relinkJournal(cwd, map)
  const remaining = [...removal.modified, ...manual]
  return {
    from, to, project, host: host ?? null,
    branch: `chore/platform-switch-${to}`,
    remove: removal.removed, conflicts: removal.modified, add, rewrite, ci, manual,
    config: configChanges, journal,
    complete: !remaining.length,
    steps: [
      `on the branch chore/platform-switch-${to}: remove ${removal.removed.length} file(s), add ${add.length}, rewrite ${rewrite.length}`,
      ...ci.map((c) => `${c.action} ${c.path}${c.why ? ` (${c.why})` : ''}`),
      `set ${configChanges.map((c) => c.key).join(', ')} in agent-os.json; the lock records ${to}`,
      ...(journal.relink.length ? [`re-link ${journal.relink.reduce((n, r) => n + r.changes.length, 0)} reference(s) in ${journal.relink.length} journal entr${journal.relink.length === 1 ? 'y' : 'ies'} from the importer's map`] : []),
      `one ${to === 'gitlab' ? 'merge request' : 'pull request'} with all of it, opened on the new platform`,
    ],
  }
}
