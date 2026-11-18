// The tracker adapter for GitHub: issues, sub-issues, dependencies, assignees, linked branches, the planning board
// (Projects v2) and milestone progress, through `gh api`. Every mutating operation accepts { dryRun } and then
// returns the request it would send instead of sending it. A missing `project` scope degrades to a warning.

import { CliError } from '../cli/errors.mjs'

const ALREADY = /already|duplicate sub-issues|already exists|has already been taken/i

/** An issue from the REST API, in the tracker's shape. */
const issueOf = (i) => ({ number: i.number, title: i.title, state: i.state, url: i.html_url, labels: (i.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)), milestone: i.milestone ? { title: i.milestone.title, dueOn: i.milestone.due_on ?? null } : null, assignees: (i.assignees ?? []).map((a) => a.login), createdAt: i.created_at ?? null })

const CONTEXTS = 'contexts(first:100){ nodes{ __typename ... on CheckRun { name status conclusion startedAt detailsUrl } ... on StatusContext { context state targetUrl createdAt } } }'

/**
 * The checks of a commit, one per name: the latest run wins, as for required checks. A re-run after a fix leaves the
 * old failed run on the same commit, and the platform's own rollup state still counts it. A run that has a
 * conclusion is finished, even when the API still reports it in progress (seen on GitHub after the job completed).
 */
export function checksOf(rollup) {
  const latest = new Map()
  for (const c of rollup?.contexts?.nodes ?? []) {
    const check = c.__typename === 'StatusContext'
      ? { name: c.context, at: c.createdAt ?? '', state: c.state === 'SUCCESS' ? 'success' : c.state === 'PENDING' || c.state === 'EXPECTED' ? 'pending' : 'failure', url: c.targetUrl ?? null }
      : { name: c.name, at: c.startedAt ?? '', state: !c.conclusion && c.status !== 'COMPLETED' ? 'pending' : ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(c.conclusion) ? 'success' : 'failure', url: c.detailsUrl ?? null }
    const seen = latest.get(check.name)
    if (!seen || check.at >= seen.at) latest.set(check.name, check)
  }
  const all = [...latest.values()].map(({ at, ...c }) => c)
  const overall = !all.length ? (rollup ? (rollup.state === 'SUCCESS' ? 'success' : rollup.state === 'PENDING' ? 'pending' : 'failure') : 'none') : all.some((c) => c.state === 'failure') ? 'failure' : all.some((c) => c.state === 'pending') ? 'pending' : 'success'
  return { overall, all }
}

export class GitHubTracker {
  /**
   * @param {{ repo: string, host?: string, board?: { owner: string, number: number } }} target
   * @param {ReturnType<import('./gh.mjs').ghClient>} client
   */
  constructor({ repo, host, board }, client) {
    if (!repo || !repo.includes('/')) throw new CliError('platform.project is not set', { hint: 'run "agent-os platform detect --write" or "agent-os config set platform.project owner/name"' })
    this.repo = repo
    this.host = host
    this.board = board
    this.gh = client
    this.cache = { ids: new Map(), milestones: null, board: undefined }
    this.warnings = []
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /** The login of the person the CLI is authenticated as. */
  whoami() {
    this.cache.me ??= this.gh.rest('GET', 'user')?.login ?? null
    return this.cache.me
  }

  /** One issue with its labels, milestone, assignees and state. */
  get(number) {
    const i = this.gh.rest('GET', `repos/${this.repo}/issues/${number}`)
    this.cache.ids.set(number, { id: i.id, nodeId: i.node_id })
    return { number: i.number, title: i.title, body: i.body ?? '', state: i.state, url: i.html_url, labels: i.labels.map((l) => l.name), milestone: i.milestone?.title ?? null, assignees: i.assignees.map((a) => a.login), isPullRequest: Boolean(i.pull_request) }
  }

  /** The conversation on an issue or pull request: its comments, oldest first ({ author, bot, body, at, url }). */
  comments(number) {
    const out = []
    for (let page = 1; page <= 10; page++) {
      const batch = this.gh.rest('GET', `repos/${this.repo}/issues/${number}/comments?per_page=100&page=${page}`) ?? []
      out.push(...batch)
      if (batch.length < 100) break
    }
    return out.map((c) => ({ author: c.user?.login ?? null, bot: c.user?.type === 'Bot', body: c.body ?? '', at: c.created_at, url: c.html_url ?? null }))
  }

  /** The sub-issues of an issue. */
  children(number) {
    return (this.gh.rest('GET', `repos/${this.repo}/issues/${number}/sub_issues?per_page=100`) ?? []).map((i) => ({ number: i.number, title: i.title, state: i.state }))
  }

  /** The issues blocking an issue. */
  blockers(number) {
    return (this.gh.rest('GET', `repos/${this.repo}/issues/${number}/dependencies/blocked_by?per_page=100`) ?? []).map((i) => ({ number: i.number, title: i.title, state: i.state }))
  }

  /** Issues matching a search query (title and body, open and closed), most relevant first. */
  search(query, { limit = 20 } = {}) {
    const q = encodeURIComponent(`repo:${this.repo} is:issue ${query}`)
    return (this.gh.rest('GET', `search/issues?q=${q}&per_page=${limit}`)?.items ?? []).map((i) => ({ number: i.number, title: i.title, state: i.state, body: i.body ?? '', url: i.html_url }))
  }

  /** Every open issue (not pull requests), with labels, milestone and assignees. Pages of 100, at most 2000. */
  openIssues() {
    const all = []
    for (let page = 1; page <= 20; page++) {
      const batch = this.gh.rest('GET', `repos/${this.repo}/issues?state=open&per_page=100&page=${page}`) ?? []
      all.push(...batch.filter((i) => !i.pull_request).map(issueOf))
      if (batch.length < 100) break
    }
    return all
  }

  /** Open issues assigned to a person, most recently updated first. */
  assignedIssues(login, { limit = 10 } = {}) {
    return (this.gh.rest('GET', `repos/${this.repo}/issues?state=open&assignee=${encodeURIComponent(login)}&sort=updated&direction=desc&per_page=${limit}`) ?? []).filter((i) => !i.pull_request).map(issueOf)
  }

  /**
   * What happened since a time: issues and change requests opened, closed and merged, comments, reviews, milestones
   * and releases, as events { at, kind, number, title, actor, url, labels, body }.
   */
  activity(since, { maxReviews = 30 } = {}) {
    const after = (t) => t && t >= since
    const pages = (path, max = 20) => {
      const out = []
      for (let page = 1; page <= max; page++) {
        const batch = this.gh.rest('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`) ?? []
        out.push(...batch)
        if (batch.length < 100) break
      }
      return out
    }
    const events = []
    const items = pages(`repos/${this.repo}/issues?state=all&sort=updated&direction=desc&since=${encodeURIComponent(since)}`)
    for (const i of items) {
      const cr = Boolean(i.pull_request)
      const base = { number: i.number, title: i.title, labels: (i.labels ?? []).map((l) => l.name), body: i.body ?? '', url: i.html_url, cr }
      if (after(i.created_at)) events.push({ ...base, at: i.created_at, kind: cr ? 'cr-opened' : 'issue-opened', actor: i.user?.login ?? null })
      if (cr && after(i.pull_request?.merged_at)) events.push({ ...base, at: i.pull_request.merged_at, kind: 'cr-merged', actor: i.closed_by?.login ?? null })
      else if (after(i.closed_at)) events.push({ ...base, at: i.closed_at, kind: cr ? 'cr-closed' : 'issue-closed', actor: i.closed_by?.login ?? null })
    }
    for (const c of pages(`repos/${this.repo}/issues/comments?sort=created&direction=asc&since=${encodeURIComponent(since)}`)) {
      if (!after(c.created_at)) continue
      const number = Number(String(c.issue_url).split('/').pop())
      const item = items.find((i) => i.number === number)
      events.push({ at: c.created_at, kind: 'comment', number, title: item?.title ?? null, actor: c.user?.login ?? null, url: c.html_url, labels: (item?.labels ?? []).map((l) => l.name), body: c.body ?? '', cr: Boolean(item?.pull_request) })
    }
    for (const pr of items.filter((i) => i.pull_request).slice(0, maxReviews)) {
      for (const r of this.gh.rest('GET', `repos/${this.repo}/pulls/${pr.number}/reviews?per_page=100`) ?? []) {
        if (after(r.submitted_at) && r.state !== 'PENDING') events.push({ at: r.submitted_at, kind: 'review', number: pr.number, title: pr.title, actor: r.user?.login ?? null, url: r.html_url, labels: (pr.labels ?? []).map((l) => l.name), body: r.state.toLowerCase().replace(/_/g, ' '), cr: true })
      }
    }
    for (const m of pages(`repos/${this.repo}/milestones?state=all`, 5)) {
      if (after(m.created_at)) events.push({ at: m.created_at, kind: 'milestone-opened', number: null, title: m.title, actor: m.creator?.login ?? null, url: m.html_url, labels: [], body: '' })
      if (after(m.closed_at)) events.push({ at: m.closed_at, kind: 'milestone-closed', number: null, title: m.title, actor: null, url: m.html_url, labels: [], body: '' })
    }
    for (const r of pages(`repos/${this.repo}/releases`, 3)) {
      if (after(r.published_at)) events.push({ at: r.published_at, kind: 'release', number: null, title: r.name || r.tag_name, actor: r.author?.login ?? null, url: r.html_url, labels: [], body: '' })
    }
    return events
  }

  /** Issues closed recently with this person assigned, newest first. */
  recentlyClosed(login, { limit = 20 } = {}) {
    return (this.gh.rest('GET', `repos/${this.repo}/issues?state=closed&assignee=${encodeURIComponent(login)}&sort=updated&direction=desc&per_page=${limit}`) ?? []).filter((i) => !i.pull_request).map(issueOf)
  }

  /** The issues an issue blocks. */
  blocking(number) {
    return (this.gh.rest('GET', `repos/${this.repo}/issues/${number}/dependencies/blocking?per_page=100`) ?? []).map((i) => ({ number: i.number, title: i.title, state: i.state }))
  }

  /**
   * Open pull requests matching a search ("author:@me", "review-requested:@me"), with their review decision and the
   * state of the checks on their last commit.
   */
  pullRequests(filter) {
    const q = `query($q:String!){ search(query:$q, type:ISSUE, first:50){ nodes{ ... on PullRequest { number title url isDraft reviewDecision commits(last:1){ nodes{ commit{ statusCheckRollup{ state ${CONTEXTS} } } } } } } } }`
    const nodes = this.gh.graphql(q, { q: `repo:${this.repo} is:pr is:open ${filter}` })?.search?.nodes ?? []
    return nodes.filter((n) => n?.number).map((n) => ({ number: n.number, title: n.title, url: n.url, draft: Boolean(n.isDraft), review: n.reviewDecision ?? null, checks: (() => { const r = n.commits?.nodes?.[0]?.commit?.statusCheckRollup; return r ? { success: 'SUCCESS', pending: 'PENDING', failure: 'FAILURE', none: null }[checksOf(r).overall] : null })() }))
  }

  /** Every pull request, open and closed (newest first, at most `max`): number, title, body, state, merged, labels, author. */
  allPullRequests({ max = 2000 } = {}) {
    const out = []
    for (let page = 1; out.length < max; page++) {
      const batch = this.gh.rest('GET', `repos/${this.repo}/pulls?state=all&sort=created&direction=desc&per_page=100&page=${page}`) ?? []
      out.push(...batch.map((p) => ({ number: p.number, title: p.title, body: p.body ?? '', state: p.state, merged: Boolean(p.merged_at), mergedAt: p.merged_at ?? null, createdAt: p.created_at ?? null, labels: (p.labels ?? []).map((l) => l.name), author: p.user?.login ?? null, url: p.html_url })))
      if (batch.length < 100) break
    }
    return out.slice(0, max)
  }

  /** Every issue, open and closed (pull requests left out, at most `max`): number, title, state, labels. */
  allIssues({ max = 5000 } = {}) {
    const out = []
    for (let page = 1; out.length < max; page++) {
      const batch = this.gh.rest('GET', `repos/${this.repo}/issues?state=all&per_page=100&page=${page}`) ?? []
      out.push(...batch.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, state: i.state, labels: (i.labels ?? []).map((l) => l.name), url: i.html_url })))
      if (batch.length < 100) break
    }
    return out.slice(0, max)
  }

  /** The names of every label in the repository. */
  labels() {
    const out = []
    for (let page = 1; page <= 10; page++) {
      const batch = this.gh.rest('GET', `repos/${this.repo}/labels?per_page=100&page=${page}`) ?? []
      out.push(...batch.map((l) => l.name))
      if (batch.length < 100) break
    }
    return out
  }

  /** Open and closed issue counts per milestone (or one milestone by title). */
  progress(milestone) {
    const all = this.milestones()
    const list = milestone ? all.filter((m) => m.title === milestone) : all
    if (milestone && !list.length) throw new CliError(`milestone "${milestone}" does not exist`, { hint: `milestones: ${all.map((m) => m.title).join(', ')}` })
    return list.map((m) => ({ title: m.title, state: m.state, open: m.open_issues, closed: m.closed_issues, total: m.open_issues + m.closed_issues }))
  }

  milestones() {
    this.cache.milestones ??= this.gh.rest('GET', `repos/${this.repo}/milestones?state=all&per_page=100`) ?? []
    return this.cache.milestones
  }

  milestoneNumber(title) {
    const m = this.milestones().find((x) => x.title === title)
    if (!m) throw new CliError(`milestone "${title}" does not exist`, { hint: `milestones: ${this.milestones().map((x) => x.title).join(', ')}` })
    return m.number
  }

  ids(number) {
    if (!this.cache.ids.has(number)) this.get(number)
    return this.cache.ids.get(number)
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  /**
   * Creates an issue, then relates it (parent, blocked by) and places it on the board.
   * @param {{ title: string, body?: string, labels?: string[], milestone?: string, assignees?: string[], parent?: number, blockedBy?: number[], status?: string }} spec
   */
  create(spec, { dryRun = false } = {}) {
    if (!spec.title) throw new CliError('an issue needs a title')
    const body = { title: spec.title, body: spec.body ?? '', labels: spec.labels ?? [], assignees: spec.assignees ?? [] }
    if (spec.milestone) body.milestone = dryRun ? spec.milestone : this.milestoneNumber(spec.milestone)
    if (dryRun) return { dryRun: true, requests: [{ method: 'POST', path: `repos/${this.repo}/issues`, body }, ...this.followUps(spec, '<new>')] }
    const i = this.gh.rest('POST', `repos/${this.repo}/issues`, body)
    this.cache.ids.set(i.number, { id: i.id, nodeId: i.node_id })
    const result = { number: i.number, url: i.html_url, related: [] }
    if (spec.parent) result.related.push(this.setParent(i.number, spec.parent))
    for (const b of spec.blockedBy ?? []) result.related.push(this.addBlocker(i.number, b))
    if (spec.status) result.board = this.setStatus(i.number, spec.status)
    return result
  }

  followUps(spec, number) {
    return [
      ...(spec.parent ? [{ method: 'POST', path: `repos/${this.repo}/issues/${spec.parent}/sub_issues`, body: { sub_issue_id: `<id of #${number}>` } }] : []),
      ...(spec.blockedBy ?? []).map((b) => ({ method: 'POST', path: `repos/${this.repo}/issues/${number}/dependencies/blocked_by`, body: { issue_id: `<id of #${b}>` } })),
      ...(spec.status ? [{ graphql: 'updateProjectV2ItemFieldValue', field: 'Status', value: spec.status }] : []),
    ]
  }

  /** Changes title, body, state, milestone or labels. */
  update(number, { title, body, state, milestone, addLabels = [], removeLabels = [] }, { dryRun = false } = {}) {
    const patch = {}
    if (title !== undefined) patch.title = title
    if (body !== undefined) patch.body = body
    if (state !== undefined) patch.state = state
    if (milestone !== undefined) patch.milestone = milestone === null ? null : dryRun ? milestone : this.milestoneNumber(milestone)
    const requests = [
      ...(Object.keys(patch).length ? [{ method: 'PATCH', path: `repos/${this.repo}/issues/${number}`, body: patch }] : []),
      ...(addLabels.length ? [{ method: 'POST', path: `repos/${this.repo}/issues/${number}/labels`, body: { labels: addLabels } }] : []),
      ...removeLabels.map((l) => ({ method: 'DELETE', path: `repos/${this.repo}/issues/${number}/labels/${encodeURIComponent(l)}` })),
    ]
    if (dryRun) return { dryRun: true, requests }
    for (const r of requests) this.gh.rest(r.method, r.path, r.body)
    return { number, updated: requests.length }
  }

  /** Makes `child` a sub-issue of `parent`; linking twice is not an error. */
  setParent(child, parent, { dryRun = false } = {}) {
    const request = { method: 'POST', path: `repos/${this.repo}/issues/${parent}/sub_issues`, body: { sub_issue_id: dryRun ? `<id of #${child}>` : this.ids(child).id } }
    if (dryRun) return { dryRun: true, requests: [request] }
    return this.idempotent(request, { relation: 'parent', child, parent })
  }

  /** Records that `number` is blocked by `blocker`. */
  addBlocker(number, blocker, { dryRun = false } = {}) {
    const request = { method: 'POST', path: `repos/${this.repo}/issues/${number}/dependencies/blocked_by`, body: { issue_id: dryRun ? `<id of #${blocker}>` : this.ids(blocker).id } }
    if (dryRun) return { dryRun: true, requests: [request] }
    return this.idempotent(request, { relation: 'blocked-by', number, blocker })
  }

  idempotent(request, result) {
    try {
      this.gh.rest(request.method, request.path, request.body)
      return { ...result, created: true }
    } catch (err) {
      if (ALREADY.test(err.output ?? err.message)) return { ...result, created: false, note: 'already linked' }
      throw err
    }
  }

  /** Adds a comment to an issue. */
  comment(number, body, { dryRun = false } = {}) {
    const request = { method: 'POST', path: `repos/${this.repo}/issues/${number}/comments`, body: { body } }
    if (dryRun) return { dryRun: true, requests: [request] }
    const c = this.gh.rest(request.method, request.path, request.body)
    return { number, comment: c?.html_url ?? null }
  }

  /** Appends a line to an issue's body (used by fallbacks such as "Blocked by #N"). */
  appendToBody(number, line, { dryRun = false } = {}) {
    if (dryRun) return { dryRun: true, requests: [{ method: 'PATCH', path: `repos/${this.repo}/issues/${number}`, body: { body: `<current body>\n${line}` } }] }
    const current = this.gh.rest('GET', `repos/${this.repo}/issues/${number}`)?.body ?? ''
    if (current.split('\n').includes(line)) return { number, unchanged: true }
    this.gh.rest('PATCH', `repos/${this.repo}/issues/${number}`, { body: `${current}${current.endsWith('\n') || !current ? '' : '\n'}${line}` })
    return { number, appended: line }
  }

  /** Adds assignees. */
  assign(number, logins, { dryRun = false } = {}) {
    const request = { method: 'POST', path: `repos/${this.repo}/issues/${number}/assignees`, body: { assignees: logins } }
    if (dryRun) return { dryRun: true, requests: [request] }
    this.gh.rest(request.method, request.path, request.body)
    return { number, assignees: logins }
  }

  /** Creates the branch for an issue and links it in the issue's Development panel. */
  linkBranch(number, { branch, base }, { dryRun = false } = {}) {
    const repoArg = this.host && this.host !== 'github.com' ? `${this.host}/${this.repo}` : this.repo
    const args = ['issue', 'develop', String(number), '--repo', repoArg, '--name', branch, ...(base ? ['--base', base] : [])]
    if (dryRun) return { dryRun: true, requests: [{ command: `gh ${args.join(' ')}` }] }
    this.gh.raw(args)
    return { number, branch, base: base ?? null }
  }

  // ── Change requests ──────────────────────────────────────────────────────

  /** Opens a pull request. */
  createPullRequest({ title, body, head, base, draft = false }, { dryRun = false } = {}) {
    const request = { method: 'POST', path: `repos/${this.repo}/pulls`, body: { title, body, head, base, draft } }
    if (dryRun) return { dryRun: true, requests: [request] }
    const pr = this.gh.rest(request.method, request.path, request.body)
    return { number: pr.number, url: pr.html_url }
  }

  /** Every open pull request, with its branch, head commit and author. */
  openPullRequests() {
    const out = []
    for (let page = 1; page <= 10; page++) {
      const batch = this.gh.rest('GET', `repos/${this.repo}/pulls?state=open&per_page=100&page=${page}`) ?? []
      out.push(...batch.map((p) => ({ number: p.number, title: p.title, body: p.body ?? '', author: p.user?.login ?? null, branch: p.head?.ref ?? null, head: p.head?.sha ?? null, url: p.html_url })))
      if (batch.length < 100) break
    }
    return out
  }

  /** The files a pull request changes (old and new names of renames). */
  pullRequestFiles(number) {
    const out = []
    for (let page = 1; page <= 30; page++) {
      const batch = this.gh.rest('GET', `repos/${this.repo}/pulls/${number}/files?per_page=100&page=${page}`) ?? []
      for (const f of batch) { out.push(f.filename); if (f.previous_filename) out.push(f.previous_filename) }
      if (batch.length < 100) break
    }
    return out
  }

  /** The open pull request for a branch, or null. */
  pullRequestFor(branch) {
    const owner = this.repo.split('/')[0]
    const list = this.gh.rest('GET', `repos/${this.repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=1`) ?? []
    return list[0] ? { number: list[0].number, url: list[0].html_url } : null
  }

  /** The open pull request from `head` into `base`, or null. */
  findPullRequest({ head, base }) {
    const owner = this.repo.split('/')[0]
    const list = this.gh.rest('GET', `repos/${this.repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}&base=${encodeURIComponent(base)}&per_page=1`) ?? []
    return list[0] ? { number: list[0].number, url: list[0].html_url } : null
  }

  updatePullRequest(number, { title, body }, { dryRun = false } = {}) {
    const request = { method: 'PATCH', path: `repos/${this.repo}/pulls/${number}`, body: { ...(title ? { title } : {}), ...(body !== undefined ? { body } : {}) } }
    if (dryRun) return { dryRun: true, requests: [request] }
    const pr = this.gh.rest(request.method, request.path, request.body)
    return { number, url: pr?.html_url ?? null }
  }

  /** The most recent release tag reachable is read from git; this creates a tag on a commit, idempotently. */
  createTag(tag, sha, { dryRun = false } = {}) {
    const request = { method: 'POST', path: `repos/${this.repo}/git/refs`, body: { ref: `refs/tags/${tag}`, sha } }
    if (dryRun) return { dryRun: true, requests: [request] }
    try { this.gh.rest(request.method, request.path, request.body); return { tag, sha, created: true } } catch (err) {
      if (!/HTTP 422|Reference already exists/i.test(err.output ?? err.message)) throw err
      const existing = this.gh.rest('GET', `repos/${this.repo}/git/ref/tags/${encodeURIComponent(tag)}`)?.object?.sha
      if (existing !== sha) throw new CliError(`the tag ${tag} already exists on another commit (${String(existing).slice(0, 7)})`, { hint: 'releases are never re-tagged: pick the next version' })
      return { tag, sha, created: false }
    }
  }

  /** Creates the platform release for a tag, or updates its notes when it exists (safe to rerun). */
  publishRelease({ tag, name, body }, { dryRun = false } = {}) {
    if (dryRun) return { dryRun: true, requests: [{ method: 'POST', path: `repos/${this.repo}/releases`, body: { tag_name: tag, name, body } }] }
    let existing = null
    try { existing = this.gh.rest('GET', `repos/${this.repo}/releases/tags/${encodeURIComponent(tag)}`) } catch (err) { if (!/HTTP 404/.test(err.output ?? err.message)) throw err }
    const r = existing ? this.gh.rest('PATCH', `repos/${this.repo}/releases/${existing.id}`, { name, body }) : this.gh.rest('POST', `repos/${this.repo}/releases`, { tag_name: tag, name, body })
    return { tag, url: r?.html_url ?? null, created: !existing }
  }

  createMilestone({ title, description }, { dryRun = false } = {}) {
    const request = { method: 'POST', path: `repos/${this.repo}/milestones`, body: { title, description } }
    if (dryRun) return { dryRun: true, requests: [request] }
    const m = this.gh.rest(request.method, request.path, request.body)
    this.cache.milestones = null
    return { number: m.number, title }
  }

  updateMilestone(number, { title, description, state }, { dryRun = false } = {}) {
    const request = { method: 'PATCH', path: `repos/${this.repo}/milestones/${number}`, body: { ...(title ? { title } : {}), ...(description !== undefined ? { description } : {}), ...(state ? { state } : {}) } }
    if (dryRun) return { dryRun: true, requests: [request] }
    this.gh.rest(request.method, request.path, request.body)
    this.cache.milestones = null
    return { number, ...request.body }
  }

  /** Adds labels to a pull request (through the issues endpoint; `gh pr edit` fails on classic Projects). */
  labelChangeRequest(number, labels, { dryRun = false } = {}) {
    const request = { method: 'POST', path: `repos/${this.repo}/issues/${number}/labels`, body: { labels } }
    if (dryRun) return { dryRun: true, requests: [request] }
    if (labels.length) this.gh.rest(request.method, request.path, request.body)
    return { number, labels }
  }

  /** Requests reviews on a pull request from people (login) and teams (org/team). */
  requestReviewers(number, owners, { dryRun = false } = {}) {
    const people = owners.filter((o) => !o.includes('/')).map((o) => o.replace(/^@/, ''))
    const teams = owners.filter((o) => o.includes('/')).map((o) => o.replace(/^@/, '').split('/').pop())
    const request = { method: 'POST', path: `repos/${this.repo}/pulls/${number}/requested_reviewers`, body: { reviewers: people, team_reviewers: teams } }
    if (dryRun) return { dryRun: true, requests: [request] }
    if (people.length || teams.length) this.gh.rest(request.method, request.path, request.body)
    return { number, reviewers: people, teams }
  }

  /** A file of another repository at a ref (a pinned commit or tag), or null when it is not there. */
  fileAt(repo, path, ref) {
    try {
      const r = this.gh.rest('GET', `repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`)
      return r?.content ? Buffer.from(r.content, r.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8') : null
    } catch (err) { if (/HTTP 404/.test(err.output ?? err.message)) return null; throw err }
  }

  /** Comments on a pull request (a pull request is an issue for comments on GitHub). */
  commentChangeRequest(number, body, options) { return this.comment(number, body, options) }

  /** The state of a pull request: review decision and every check on its last commit. */
  pullRequestStatus(number) {
    const [owner, name] = this.repo.split('/')
    const q = `query($o:String!,$n:String!,$p:Int!){ repository(owner:$o,name:$n){ pullRequest(number:$p){ number title body url state isDraft mergeable mergeStateStatus reviewDecision baseRefName headRefName isCrossRepository author{ login } commits(last:1){ nodes{ commit{ oid statusCheckRollup{ state ${CONTEXTS} } } } } } } }`
    const pr = this.gh.graphql(q, { o: owner, n: name, p: number })?.repository?.pullRequest
    if (!pr) throw new CliError(`pull request #${number} not found`)
    const commit = pr.commits?.nodes?.[0]?.commit
    const { overall, all: checks } = checksOf(commit?.statusCheckRollup)
    return { number: pr.number, title: pr.title ?? null, body: pr.body ?? '', author: pr.author?.login ?? null, base: pr.baseRefName ?? null, branch: pr.headRefName ?? null, fork: Boolean(pr.isCrossRepository), mergeState: pr.mergeStateStatus ?? null, url: pr.url, state: pr.state.toLowerCase(), draft: Boolean(pr.isDraft), mergeable: pr.mergeable ?? null, review: pr.reviewDecision ?? null, head: commit?.oid ?? null, checks: overall, failing: checks.filter((c) => c.state === 'failure'), pending: checks.filter((c) => c.state === 'pending').map((c) => c.name), all: checks }
  }

  /** Merges a pull request, only if its head is still `sha` (so what was checked is what is merged). */
  mergePullRequest(number, { method = 'squash', sha, title }, { dryRun = false } = {}) {
    const request = { method: 'PUT', path: `repos/${this.repo}/pulls/${number}/merge`, body: { merge_method: method, ...(sha ? { sha } : {}), ...(title && method === 'squash' ? { commit_title: `${title} (#${number})` } : {}) } }
    if (dryRun) return { dryRun: true, requests: [request] }
    const r = this.gh.rest(request.method, request.path, request.body)
    return { number, merged: Boolean(r?.merged), sha: r?.sha ?? null }
  }

  /** Deletes a branch on the remote. */
  deleteBranch(branch, { dryRun = false } = {}) {
    const request = { method: 'DELETE', path: `repos/${this.repo}/git/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}` }
    if (dryRun) return { dryRun: true, requests: [request] }
    try { this.gh.rest(request.method, request.path) } catch (err) {
      if (/HTTP 422|Reference does not exist/i.test(err.output ?? err.message)) return { branch, deleted: false, already: true }
      throw err
    }
    return { branch, deleted: true }
  }

  /** Review threads of a pull request, with every comment. */
  reviewThreads(number) {
    const [owner, name] = this.repo.split('/')
    const q = 'query($o:String!,$n:String!,$p:Int!){ repository(owner:$o,name:$n){ pullRequest(number:$p){ reviewThreads(first:100){ nodes{ id isResolved isOutdated path line comments(first:50){ nodes{ author{ login } body url createdAt } } } } } } }'
    const nodes = this.gh.graphql(q, { o: owner, n: name, p: number })?.repository?.pullRequest?.reviewThreads?.nodes ?? []
    return nodes.map((t) => ({ id: t.id, resolved: Boolean(t.isResolved), outdated: Boolean(t.isOutdated), path: t.path ?? null, line: t.line ?? null, comments: (t.comments?.nodes ?? []).map((c) => ({ author: c.author?.login ?? null, body: c.body, url: c.url, at: c.createdAt })) }))
  }

  /** Replies in a review thread, and resolves it when asked. */
  replyToThread(threadId, body, { resolve = false, dryRun = false } = {}) {
    if (dryRun) return { dryRun: true, requests: [{ graphql: 'addPullRequestReviewThreadReply', threadId, body }, ...(resolve ? [{ graphql: 'resolveReviewThread', threadId }] : [])] }
    const reply = this.gh.graphql('mutation($t:ID!,$b:String!){ addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$t,body:$b}){ comment{ url } } }', { t: threadId, b: body })
    if (resolve) this.gh.graphql('mutation($t:ID!){ resolveReviewThread(input:{threadId:$t}){ thread{ isResolved } } }', { t: threadId })
    return { threadId, url: reply?.addPullRequestReviewThreadReply?.comment?.url ?? null, resolved: resolve }
  }

  // ── Board (Projects v2) ──────────────────────────────────────────────────

  /** The board's ids and single-select fields, or null (with a warning) when there is no board or no scope. */
  boardInfo() {
    if (this.cache.board !== undefined) return this.cache.board
    if (!this.board?.number) { this.cache.board = null; return null }
    const q = `query($o:String!,$n:Int!){ repositoryOwner(login:$o){ ... on ProjectV2Owner { projectV2(number:$n){ id fields(first:50){ nodes{ ... on ProjectV2SingleSelectField { id name options { id name } } } } } } } }`
    try {
      const p = this.gh.graphql(q, { o: this.board.owner, n: this.board.number })?.repositoryOwner?.projectV2
      if (!p) throw new CliError(`board ${this.board.owner}/${this.board.number} not found`)
      this.cache.board = { id: p.id, fields: Object.fromEntries(p.fields.nodes.filter((f) => f.name).map((f) => [f.name, f])) }
    } catch (err) {
      const scope = /scope|INSUFFICIENT_SCOPES|project/i.test(err.output ?? err.message)
      this.warnings.push(scope
        ? `the board was skipped: the token lacks the "project" scope (fix: gh auth refresh -s project)`
        : `the board was skipped: ${err.message}`)
      this.cache.board = null
    }
    return this.cache.board
  }

  /** Every item on the board with its issue number, state and single-select values; null without a board. */
  boardItems() {
    const board = this.boardInfo()
    if (!board) return null
    const q = 'query($id:ID!,$after:String){ node(id:$id){ ... on ProjectV2 { items(first:100, after:$after){ pageInfo{ hasNextPage endCursor } nodes{ id content{ ... on Issue { number state repository{ nameWithOwner } } } fieldValues(first:20){ nodes{ ... on ProjectV2ItemFieldSingleSelectValue { name field{ ... on ProjectV2SingleSelectField { name } } } } } } } } } }'
    const out = []
    let after = null
    for (let page = 0; page < 30; page++) {
      const items = this.gh.graphql(q, { id: board.id, ...(after ? { after } : {}) })?.node?.items
      for (const n of items?.nodes ?? []) {
        if (!n.content?.number || (n.content.repository?.nameWithOwner && n.content.repository.nameWithOwner !== this.repo)) continue
        out.push({ itemId: n.id, number: n.content.number, state: String(n.content.state).toLowerCase(), fields: Object.fromEntries((n.fieldValues?.nodes ?? []).filter((v) => v?.field?.name).map((v) => [v.field.name, v.name])) })
      }
      if (!items?.pageInfo?.hasNextPage) break
      after = items.pageInfo.endCursor
    }
    return out
  }

  /** Creates a board linked to the repository with the default fields (Status comes with every board). */
  createBoard({ title, fields }, { dryRun = false } = {}) {
    const steps = [`create the project "${title}" owned by ${this.repo.split('/')[0]} and link it to ${this.repo}`, ...Object.entries(fields).map(([name, options]) => `add the field ${name}: ${options.join(', ')}`)]
    if (dryRun) return { dryRun: true, steps }
    const [owner, name] = this.repo.split('/')
    const ids = this.gh.graphql('query($o:String!,$n:String!){ repositoryOwner(login:$o){ id } repository(owner:$o,name:$n){ id } }', { o: owner, n: name })
    const project = this.gh.graphql('mutation($o:ID!,$t:String!,$r:ID!){ createProjectV2(input:{ownerId:$o,title:$t,repositoryId:$r}){ projectV2{ id number url } } }', { o: ids.repositoryOwner.id, t: title, r: ids.repository.id }).createProjectV2.projectV2
    for (const [fieldName, options] of Object.entries(fields)) {
      this.gh.graphql('mutation($p:ID!,$n:String!,$o:[ProjectV2SingleSelectFieldOptionInput!]!){ createProjectV2Field(input:{projectId:$p,dataType:SINGLE_SELECT,name:$n,singleSelectOptions:$o}){ clientMutationId } }', { p: project.id, n: fieldName, o: options.map((o) => ({ name: o, color: 'GRAY', description: '' })) })
    }
    return { number: project.number, url: project.url, steps }
  }

  /** Places an issue on the board and sets a single-select field (Status by default). Without a board: a warning. */
  setStatus(number, value, { field = 'Status', dryRun = false } = {}) {
    if (dryRun) return { dryRun: true, requests: [{ graphql: 'addProjectV2ItemById + updateProjectV2ItemFieldValue', board: this.board ?? null, field, value }] }
    const board = this.boardInfo()
    if (!board) return { number, skipped: true, warnings: this.warnings }
    const f = board.fields[field]
    const option = f?.options.find((o) => o.name.toLowerCase() === String(value).toLowerCase())
    if (!option) throw new CliError(`the board has no ${field} "${value}"`, { hint: `options: ${(f?.options ?? []).map((o) => o.name).join(', ') || 'none'}` })
    const item = this.gh.graphql('mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p,contentId:$c}){ item { id } } }', { p: board.id, c: this.ids(number).nodeId }).addProjectV2ItemById.item.id
    this.gh.graphql('mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){ updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){ clientMutationId } }', { p: board.id, i: item, f: f.id, o: option.id })
    return { number, [field.toLowerCase()]: option.name }
  }
}
