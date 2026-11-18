// Capabilities: what the configured platform, tier and version can do, and what to do instead when it cannot. Skills
// and commands ask `has(caps, id)` or `plan…(caps, …)`, never "is this GitLab?". Design §20.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Every capability, what it means and its fallback when missing. */
export const CAPABILITIES = {
  subItems: { means: 'parent and child issues (GitHub sub-issues, GitLab epics or child tasks)', fallback: '"Parent: #N" line in the child + a checklist in the parent' },
  dependencies: { means: 'blocked by / blocking links', fallback: '"relates to" link + the blocked label + a "Blocked by #N" line' },
  exclusiveLabels: { means: 'label groups where only one label applies (GitLab scoped labels)', fallback: 'naming convention (type:*), checked by doctor' },
  multipleAssignees: { means: 'several assignees on one issue', fallback: 'one assignee + @mentions in a comment' },
  board: { means: 'a planning board with a status field', fallback: 'milestones and labels only' },
  pages: { means: 'a static site for artifacts', fallback: 'CI job artifacts linked from the change request' },
  branchRules: { means: 'rules beyond protected branches (GitHub rulesets, GitLab push rules)', fallback: 'protected branches only' },
  linkedBranches: { means: 'branches linked to an issue by the platform', fallback: '"Closes #N" in the change request' },
}

const v = (value, source, note) => ({ value, source, ...(note ? { note } : {}) })

/** Reads the HTTP status from a client error ("... (HTTP 404)"), or null. */
const statusOf = (err) => Number(String(err?.output ?? err?.message ?? '').match(/HTTP (\d{3})/)?.[1]) || null

async function tryGet(get, path) {
  try { return { ok: true, body: await get(path) } } catch (err) { return { ok: false, status: statusOf(err) } }
}

/**
 * GitHub: github.com capabilities are known; Enterprise Server is probed, since it lags behind github.com.
 * @param {{ host?: string, project: string, board?: object }} platform
 * @param {{ rest: (method: string, path: string) => unknown }} client a ghClient
 */
export async function probeGitHub(platform, client) {
  const enterprise = Boolean(platform.host && new URL(platform.host).host !== 'github.com')
  const get = (path) => client.rest('GET', path)
  const caps = {
    exclusiveLabels: v(false, 'known', 'GitHub has no exclusive labels'),
    multipleAssignees: v(true, 'known'),
    linkedBranches: v(true, 'known', 'gh issue develop'),
    board: v(Boolean(platform.board?.number), 'config', platform.board?.number ? 'platform.board is set; the token needs the project scope' : 'no platform.board configured'),
  }
  if (!enterprise) {
    return { ...caps, subItems: v(true, 'known'), dependencies: v(true, 'known'), pages: v(true, 'known'), branchRules: v(true, 'known', 'rulesets') }
  }
  const issue = await tryGet(get, `repos/${platform.project}/issues?state=all&per_page=1`)
  const n = issue.ok && issue.body?.[0]?.number
  const sub = n ? await tryGet(get, `repos/${platform.project}/issues/${n}/sub_issues?per_page=1`) : null
  const dep = n ? await tryGet(get, `repos/${platform.project}/issues/${n}/dependencies/blocked_by?per_page=1`) : null
  const rules = await tryGet(get, `repos/${platform.project}/rulesets?per_page=1`)
  const pages = await tryGet(get, `repos/${platform.project}/pages`)
  const probed = (r, what) => (r === null ? v(null, 'unknown', `no issue to probe ${what} with`) : v(r.ok, 'probed', r.ok ? undefined : `HTTP ${r.status ?? '?'}`))
  return {
    ...caps,
    subItems: probed(sub, 'sub-issues'),
    dependencies: probed(dep, 'dependencies'),
    branchRules: v(rules.ok, 'probed', rules.ok ? 'rulesets' : `HTTP ${rules.status ?? '?'}`),
    pages: v(pages.ok || pages.status === 404, 'probed', pages.ok ? 'enabled' : pages.status === 404 ? 'available, not enabled' : `HTTP ${pages.status ?? '?'}`),
  }
}

/**
 * GitLab: features depend on the tier. Premium is recognized from the group epics endpoint; the rest follows from the
 * tier and is marked "inferred". Free-tier features are probed directly.
 * @param {{ project: string }} platform
 * @param {{ get: (path: string) => unknown }} client a glab client
 */
export async function probeGitLab(platform, client) {
  const id = encodeURIComponent(platform.project)
  const group = encodeURIComponent(platform.project.split('/').slice(0, -1).join('/'))
  const version = await tryGet(client.get, 'version')
  const project = await tryGet(client.get, `projects/${id}`)
  const epics = group ? await tryGet(client.get, `groups/${group}/epics?per_page=1`) : { ok: false, status: null }
  const pushRule = await tryGet(client.get, `projects/${id}/push_rule`)
  const premium = epics.ok || pushRule.ok
  const tier = premium ? 'premium or ultimate' : epics.status === 403 || epics.status === 404 ? 'free' : 'unknown'
  const inferred = (value, note) => v(tier === 'unknown' ? null : value, tier === 'unknown' ? 'unknown' : 'inferred', note ?? `GitLab ${tier}`)
  const pagesLevel = project.ok ? project.body?.pages_access_level : undefined
  return {
    tier: v(tier, premium ? 'probed' : epics.status ? 'probed' : 'unknown', version.ok ? `GitLab ${version.body?.version}` : 'the API did not answer: is glab installed and logged in? (agent-os env); fallbacks apply until it does'),
    subItems: premium ? v('epics', 'probed', 'group epics') : v('tasks', tier === 'unknown' ? 'unknown' : 'inferred', 'child tasks on issues; epics need Premium'),
    dependencies: inferred(premium, premium ? 'blocking links' : 'blocking links need Premium'),
    exclusiveLabels: inferred(premium, 'scoped labels'),
    multipleAssignees: inferred(premium),
    board: v(true, 'known', premium ? 'issue boards with iterations' : 'one issue board per project'),
    pages: v(pagesLevel !== undefined && pagesLevel !== 'disabled', project.ok ? 'probed' : 'unknown', pagesLevel ? `pages_access_level: ${pagesLevel}` : 'Pages may be disabled by the administrator'),
    branchRules: v(pushRule.ok, 'probed', pushRule.ok ? 'push rules' : 'protected branches only'),
    linkedBranches: v(false, 'known', 'GitLab links branches by name (<N>-<slug>) and through "Closes #N"'),
  }
}

/** True only when a capability is known to be available (unknown counts as missing, so fallbacks are used). */
export const has = (caps, id) => Boolean(caps?.[id]?.value)

/**
 * What to do to record "issue is blocked by blocker", given the capabilities.
 * @returns {{ native: boolean, actions: { do: string, [key: string]: unknown }[] }}
 */
export function planBlockedBy(caps, { issue, blocker }) {
  if (has(caps, 'dependencies')) return { native: true, actions: [{ do: 'link', type: 'blocked-by', issue, blocker }] }
  return {
    native: false,
    actions: [
      { do: 'link', type: 'relates-to', issue, blocker },
      { do: 'add-label', issue, label: 'blocked' },
      { do: 'body-line', issue, line: `Blocked by #${blocker}` },
    ],
  }
}

/** What to do to make `child` part of `parent`. */
export function planParent(caps, { child, parent }) {
  if (has(caps, 'subItems')) return { native: true, actions: [{ do: 'link', type: caps.subItems.value === 'tasks' ? 'child-task' : caps.subItems.value === 'epics' ? 'epic-child' : 'sub-issue', child, parent }] }
  return { native: false, actions: [{ do: 'body-line', issue: child, line: `Parent: #${parent}` }, { do: 'checklist-item', issue: parent, item: `#${child}` }] }
}

/** What to do to assign several people. */
export function planAssignees(caps, { issue, logins }) {
  if (has(caps, 'multipleAssignees') || logins.length <= 1) return { native: true, actions: [{ do: 'assign', issue, logins }] }
  return { native: false, actions: [{ do: 'assign', issue, logins: [logins[0]] }, { do: 'comment', issue, text: `Also working on this: ${logins.slice(1).map((l) => `@${l}`).join(' ')}` }] }
}

// ── Cache ──────────────────────────────────────────────────────────────────

export const CACHE_FILE = '.agent-os/cache/platform.json'

export function readCache(cwd, { maxAgeHours = 24, now = Date.now() } = {}) {
  try {
    const c = JSON.parse(readFileSync(join(cwd, CACHE_FILE), 'utf8'))
    return now - Date.parse(c.probedAt) <= maxAgeHours * 3600e3 ? c : null
  } catch { return null }
}

export function writeCache(cwd, map) {
  mkdirSync(join(cwd, '.agent-os', 'cache'), { recursive: true })
  writeFileSync(join(cwd, CACHE_FILE), `${JSON.stringify(map, null, 2)}\n`)
}
