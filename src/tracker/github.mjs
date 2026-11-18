// The tracker adapter for GitHub: issues, sub-issues, dependencies, assignees, linked branches, the planning board
// (Projects v2) and milestone progress, through `gh api`. Every mutating operation accepts { dryRun } and then
// returns the request it would send instead of sending it. A missing `project` scope degrades to a warning.

import { CliError } from '../cli/errors.mjs'
import { ALREADY, CONTEXTS, checksOf, issueOf } from './github-shared.mjs'
import { ChangeRequestMethods } from './github-changes.mjs'
import { BoardMethods } from './github-board.mjs'

export { checksOf }

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
      out.push(...batch.map((p) => ({ number: p.number, title: p.title, body: p.body ?? '', state: p.state, merged: Boolean(p.merged_at), mergedAt: p.merged_at ?? null, createdAt: p.created_at ?? null, labels: (p.labels ?? []).map((l) => l.name), author: p.user?.login ?? null, url: p.html_url, head: p.head?.ref ?? null })))
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

}

// Change requests and the board live in their own modules; their methods become the adapter's own (one interface).
for (const part of [ChangeRequestMethods, BoardMethods]) {
  for (const name of Object.getOwnPropertyNames(part.prototype)) if (name !== 'constructor') Object.defineProperty(GitHubTracker.prototype, name, Object.getOwnPropertyDescriptor(part.prototype, name))
}
