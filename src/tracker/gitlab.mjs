// The GitLab tracker: the same interface as the GitHub one (tracker.mjs), on REST v4 and GraphQL through glab.
// Numbers are iids: #N for issues, !N for merge requests, &N for epics. Board status is a scoped label (status::…),
// because GitLab boards list issues by label. Every write takes { dryRun } and returns the requests instead.

import { CliError } from '../cli/errors.mjs'

/** GitLab answers a repeated link with 409 "already related" (or 422 on some versions). */
const ALREADY = /already (been )?(related|assigned|exists)|HTTP 409/i
const STATE = { opened: 'open', closed: 'closed', merged: 'merged', locked: 'closed' }
const PENDING = ['created', 'waiting_for_resource', 'preparing', 'pending', 'running', 'scheduled', 'manual']

const issueOf = (i) => ({ number: i.iid, title: i.title, state: STATE[i.state] ?? i.state, url: i.web_url, labels: i.labels ?? [], milestone: i.milestone ? { title: i.milestone.title, dueOn: i.milestone.due_date ?? null } : null, assignees: (i.assignees ?? []).map((a) => a.username), createdAt: i.created_at ?? null })
const slug = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export class GitLabTracker {
  /**
   * @param {{ project: string, host?: string }} target
   * @param {ReturnType<import('../platform/glab.mjs').glabClient>} client
   */
  constructor({ project, host }, client) {
    if (!project || !project.includes('/')) throw new CliError('platform.project is not set', { hint: 'run "agent-os platform detect --write" or "agent-os config set platform.project group/name"' })
    this.project = project
    this.host = host
    this.id = encodeURIComponent(project)
    this.group = encodeURIComponent(project.split('/').slice(0, -1).join('/'))
    this.api = client
    this.cache = { users: new Map(), milestones: null, issues: new Map() }
    this.warnings = []
  }

  p(path) { return `projects/${this.id}/${path}` }

  /** Every page of a list endpoint (per_page=100), at most `max` pages. */
  pages(path, max = 20) {
    const out = []
    const sep = path.includes('?') ? '&' : '?'
    for (let page = 1; page <= max; page++) {
      const batch = this.api.rest('GET', `${path}${sep}per_page=100&page=${page}`) ?? []
      out.push(...batch)
      if (batch.length < 100) break
    }
    return out
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  whoami() {
    this.cache.me ??= this.api.rest('GET', 'user')?.username ?? null
    return this.cache.me
  }

  raw(number) {
    if (!this.cache.issues.has(number)) this.cache.issues.set(number, this.api.rest('GET', this.p(`issues/${number}`)))
    return this.cache.issues.get(number)
  }

  get(number) {
    this.cache.issues.delete(number)
    const i = this.raw(number)
    return { ...issueOf(i), body: i.description ?? '', milestone: i.milestone?.title ?? null, isPullRequest: false }
  }

  /** Child items of an issue (tasks, through the work item hierarchy); empty when the instance has none. */
  children(number) {
    const q = 'query($p:ID!,$i:String!){ project(fullPath:$p){ workItems(iid:$i){ nodes{ widgets{ ... on WorkItemWidgetHierarchy { children{ nodes{ iid title state } } } } } } } }'
    try {
      const nodes = this.api.graphql(q, { p: this.project, i: String(number) })?.project?.workItems?.nodes ?? []
      return nodes.flatMap((n) => n.widgets ?? []).flatMap((w) => w.children?.nodes ?? []).map((c) => ({ number: Number(c.iid), title: c.title, state: c.state === 'OPEN' ? 'open' : 'closed' }))
    } catch { return [] }
  }

  links(number) {
    return (this.api.rest('GET', this.p(`issues/${number}/links`)) ?? []).map((l) => ({ number: l.iid, title: l.title, state: STATE[l.state] ?? l.state, type: l.link_type }))
  }

  blockers(number) { return this.links(number).filter((l) => l.type === 'is_blocked_by').map(({ type, ...l }) => l) }

  blocking(number) { return this.links(number).filter((l) => l.type === 'blocks').map(({ type, ...l }) => l) }

  search(query, { limit = 20 } = {}) {
    return (this.api.rest('GET', this.p(`issues?search=${encodeURIComponent(query)}&in=title,description&per_page=${limit}`)) ?? []).map((i) => ({ number: i.iid, title: i.title, state: STATE[i.state] ?? i.state, body: i.description ?? '', url: i.web_url }))
  }

  /** Milestones in the GitHub-like shape the workflow uses (open/closed, due_on, issue counts on demand). */
  milestones() {
    this.cache.milestones ??= this.pages(this.p('milestones?include_ancestors=true')).map((m) => ({ number: m.id, iid: m.iid, title: m.title, state: m.state === 'active' ? 'open' : 'closed', due_on: m.due_date ? `${m.due_date}T00:00:00Z` : null }))
    return this.cache.milestones
  }

  milestoneNumber(title) {
    const m = this.milestones().find((x) => x.title === title)
    if (!m) throw new CliError(`milestone "${title}" does not exist`, { hint: `milestones: ${this.milestones().map((x) => x.title).join(', ')}` })
    return m.number
  }

  progress(milestone) {
    const all = this.milestones()
    const list = milestone ? all.filter((m) => m.title === milestone) : all
    if (milestone && !list.length) throw new CliError(`milestone "${milestone}" does not exist`, { hint: `milestones: ${all.map((m) => m.title).join(', ')}` })
    return list.map((m) => {
      const c = this.api.rest('GET', this.p(`issues_statistics?milestone=${encodeURIComponent(m.title)}`))?.statistics?.counts ?? {}
      return { title: m.title, state: m.state, open: c.opened ?? 0, closed: c.closed ?? 0, total: c.all ?? (c.opened ?? 0) + (c.closed ?? 0) }
    })
  }

  openIssues() { return this.pages(this.p('issues?state=opened'), 20).map(issueOf) }

  recentlyClosed(login, { limit = 20 } = {}) {
    return (this.api.rest('GET', this.p(`issues?state=closed&assignee_username=${encodeURIComponent(login)}&order_by=updated_at&sort=desc&per_page=${limit}`)) ?? []).map(issueOf)
  }

  /** The names of every label of the project (group labels included). */
  labels() { return this.pages(this.p('labels?include_ancestor_groups=true')).map((l) => l.name) }

  userId(username) {
    if (!this.cache.users.has(username)) {
      const u = (this.api.rest('GET', `users?username=${encodeURIComponent(username)}`) ?? [])[0]
      if (!u) throw new CliError(`no GitLab user "${username}"`)
      this.cache.users.set(username, u.id)
    }
    return this.cache.users.get(username)
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  create(spec, { dryRun = false } = {}) {
    if (!spec.title) throw new CliError('an issue needs a title')
    const body = { title: spec.title, description: spec.body ?? '', labels: (spec.labels ?? []).join(',') }
    if (spec.assignees?.length) body.assignee_ids = dryRun ? spec.assignees.map((a) => `<id of ${a}>`) : spec.assignees.map((a) => this.userId(a))
    if (spec.milestone) body.milestone_id = dryRun ? spec.milestone : this.milestoneNumber(spec.milestone)
    if (dryRun) return { dryRun: true, requests: [{ method: 'POST', path: this.p('issues'), body }, ...(spec.parent ? [{ method: 'POST', path: `groups/${this.group}/epics/${spec.parent}/issues/<id of the new issue>` }] : []), ...(spec.blockedBy ?? []).map((b) => ({ method: 'POST', path: this.p('issues/<new>/links'), body: { target_issue_iid: b, link_type: 'is_blocked_by' } })), ...(spec.status ? [{ label: `status::${slug(spec.status)}` }] : [])] }
    const i = this.api.rest('POST', this.p('issues'), body)
    this.cache.issues.set(i.iid, i)
    const result = { number: i.iid, url: i.web_url, related: [] }
    if (spec.parent) result.related.push(this.setParent(i.iid, spec.parent))
    for (const b of spec.blockedBy ?? []) result.related.push(this.addBlocker(i.iid, b))
    if (spec.status) result.board = this.setStatus(i.iid, spec.status)
    return result
  }

  update(number, { title, body, state, milestone, addLabels = [], removeLabels = [] }, { dryRun = false } = {}) {
    const put = {}
    if (title !== undefined) put.title = title
    if (body !== undefined) put.description = body
    if (state !== undefined) put.state_event = state === 'closed' ? 'close' : 'reopen'
    if (milestone !== undefined) put.milestone_id = milestone === null ? 0 : dryRun ? milestone : this.milestoneNumber(milestone)
    if (addLabels.length) put.add_labels = addLabels.join(',')
    if (removeLabels.length) put.remove_labels = removeLabels.join(',')
    const requests = Object.keys(put).length ? [{ method: 'PUT', path: this.p(`issues/${number}`), body: put }] : []
    if (dryRun) return { dryRun: true, requests }
    for (const r of requests) this.cache.issues.set(number, this.api.rest(r.method, r.path, r.body))
    return { number, updated: requests.length }
  }

  /** Attaches an issue to an epic (&parent), which needs Premium; on Free the capability plan uses the fallback instead. */
  setParent(child, parent, { dryRun = false } = {}) {
    const request = { method: 'POST', path: `groups/${this.group}/epics/${parent}/issues/${dryRun ? `<id of #${child}>` : this.raw(child).id}` }
    if (dryRun) return { dryRun: true, requests: [request] }
    return this.idempotent(request, { relation: 'parent', child, parent })
  }

  addBlocker(number, blocker, { dryRun = false } = {}) {
    const request = { method: 'POST', path: this.p(`issues/${number}/links`), body: { target_project_id: this.project, target_issue_iid: String(blocker), link_type: 'is_blocked_by' } }
    if (dryRun) return { dryRun: true, requests: [request] }
    return this.idempotent(request, { relation: 'blocked-by', number, blocker })
  }

  idempotent(request, result) {
    try {
      this.api.rest(request.method, request.path, request.body)
      return { ...result, created: true }
    } catch (err) {
      if (ALREADY.test(err.output ?? err.message)) return { ...result, created: false, note: 'already linked' }
      throw err
    }
  }

  comment(number, body, { dryRun = false } = {}) {
    const request = { method: 'POST', path: this.p(`issues/${number}/notes`), body: { body } }
    if (dryRun) return { dryRun: true, requests: [request] }
    const n = this.api.rest(request.method, request.path, request.body)
    return { number, comment: n?.id ? `${this.raw(number).web_url}#note_${n.id}` : null }
  }

  appendToBody(number, line, { dryRun = false } = {}) {
    if (dryRun) return { dryRun: true, requests: [{ method: 'PUT', path: this.p(`issues/${number}`), body: { description: `<current description>\n${line}` } }] }
    this.cache.issues.delete(number)
    const current = this.raw(number)?.description ?? ''
    if (current.split('\n').includes(line)) return { number, unchanged: true }
    this.cache.issues.set(number, this.api.rest('PUT', this.p(`issues/${number}`), { description: `${current}${current.endsWith('\n') || !current ? '' : '\n'}${line}` }))
    return { number, appended: line }
  }

  assign(number, logins, { dryRun = false } = {}) {
    if (dryRun) return { dryRun: true, requests: [{ method: 'PUT', path: this.p(`issues/${number}`), body: { assignee_ids: logins.map((l) => `<id of ${l}>`) } }] }
    const current = (this.raw(number).assignees ?? []).map((a) => a.id)
    const ids = [...new Set([...current, ...logins.map((l) => this.userId(l))])]
    this.cache.issues.set(number, this.api.rest('PUT', this.p(`issues/${number}`), { assignee_ids: ids }))
    return { number, assignees: logins }
  }

  /** Creates the branch on the server; GitLab links it to the issue by its name (<N>-<slug>) and "Closes #N". */
  linkBranch(number, { branch, base }, { dryRun = false } = {}) {
    const request = { method: 'POST', path: this.p(`repository/branches?branch=${encodeURIComponent(branch)}&ref=${encodeURIComponent(base)}`) }
    if (dryRun) return { dryRun: true, requests: [request] }
    this.api.rest(request.method, request.path)
    return { number, branch, base }
  }

  /** Board status as one scoped label, status::<value>; other status:: labels are removed. */
  setStatus(number, value, { dryRun = false } = {}) {
    const label = `status::${slug(value)}`
    if (dryRun) return { dryRun: true, requests: [{ method: 'PUT', path: this.p(`issues/${number}`), body: { add_labels: label, remove_labels: '<other status:: labels>' } }] }
    const others = (this.raw(number).labels ?? []).filter((l) => l.startsWith('status::') && l !== label)
    this.cache.issues.set(number, this.api.rest('PUT', this.p(`issues/${number}`), { add_labels: label, ...(others.length ? { remove_labels: others.join(',') } : {}) }))
    return { number, status: label }
  }

  // ── Merge requests ───────────────────────────────────────────────────────

  /** Open merge requests for a search in the GitHub form: "author:<login>" or "review-requested:<login>". */
  pullRequests(filter) {
    const m = String(filter).match(/^(author|review-requested):(\S+)$/)
    if (!m) throw new CliError(`unsupported merge request filter "${filter}"`)
    const param = m[1] === 'author' ? 'author_username' : 'reviewer_username'
    const list = this.api.rest('GET', this.p(`merge_requests?state=opened&${param}=${encodeURIComponent(m[2])}&per_page=50`)) ?? []
    return list.map((mr) => {
      const s = m[1] === 'author' ? this.pullRequestStatus(mr.iid) : null
      return { number: mr.iid, title: mr.title, url: mr.web_url, draft: Boolean(mr.draft), review: s?.review ?? null, checks: s ? { success: 'SUCCESS', failure: 'FAILURE', pending: 'PENDING', none: null }[s.checks] : null }
    })
  }

  pullRequestFor(branch) {
    const mr = (this.api.rest('GET', this.p(`merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}&per_page=1`)) ?? [])[0]
    return mr ? { number: mr.iid, url: mr.web_url } : null
  }

  createPullRequest({ title, body, head, base, draft = false }, { dryRun = false } = {}) {
    const request = { method: 'POST', path: this.p('merge_requests'), body: { source_branch: head, target_branch: base, title: draft ? `Draft: ${title}` : title, description: body } }
    if (dryRun) return { dryRun: true, requests: [request] }
    const mr = this.api.rest(request.method, request.path, request.body)
    return { number: mr.iid, url: mr.web_url }
  }

  labelChangeRequest(number, labels, { dryRun = false } = {}) {
    const request = { method: 'PUT', path: this.p(`merge_requests/${number}`), body: { add_labels: labels.join(',') } }
    if (dryRun) return { dryRun: true, requests: [request] }
    if (labels.length) this.api.rest(request.method, request.path, request.body)
    return { number, labels }
  }

  commentChangeRequest(number, body, { dryRun = false } = {}) {
    const request = { method: 'POST', path: this.p(`merge_requests/${number}/notes`), body: { body } }
    if (dryRun) return { dryRun: true, requests: [request] }
    this.api.rest(request.method, request.path, request.body)
    return { number }
  }

  /** The state of a merge request in the shape /ship and /pr use: the pipeline's jobs are the checks. */
  pullRequestStatus(number) {
    const mr = this.api.rest('GET', this.p(`merge_requests/${number}`))
    const approvals = this.api.rest('GET', this.p(`merge_requests/${number}/approvals`)) ?? {}
    const pipeline = mr.head_pipeline
    const jobs = pipeline?.id ? this.pages(this.p(`pipelines/${pipeline.id}/jobs`), 5) : []
    const stateOf = (s) => (s === 'success' || s === 'skipped' ? 'success' : PENDING.includes(s) ? 'pending' : 'failure')
    const latest = new Map()
    for (const j of jobs) if (!latest.has(j.name) || j.id > latest.get(j.name).id) latest.set(j.name, j)
    const all = [...latest.values()].filter((j) => !(j.status === 'manual' && j.allow_failure)).map((j) => ({ name: j.name, state: stateOf(j.status), url: j.web_url ?? null }))
    const checks = !pipeline ? 'none' : all.length ? (all.some((c) => c.state === 'failure') ? 'failure' : all.some((c) => c.state === 'pending') ? 'pending' : 'success') : stateOf(pipeline.status)
    const dms = mr.detailed_merge_status
    const review = dms === 'requested_changes' ? 'CHANGES_REQUESTED' : approvals.approved && (approvals.approvals_required ?? 0) > 0 ? 'APPROVED' : (approvals.approved_by ?? []).length ? 'APPROVED' : null
    return {
      number: mr.iid, title: mr.title, body: mr.description ?? '', author: mr.author?.username ?? null, base: mr.target_branch, branch: mr.source_branch,
      fork: mr.source_project_id !== mr.target_project_id, url: mr.web_url, state: STATE[mr.state] ?? mr.state, draft: Boolean(mr.draft ?? mr.work_in_progress),
      mergeable: mr.has_conflicts ? 'CONFLICTING' : 'MERGEABLE', mergeState: mr.has_conflicts || dms === 'conflict' ? 'DIRTY' : dms === 'need_rebase' ? 'BEHIND' : 'CLEAN',
      review, head: mr.sha, checks, failing: all.filter((c) => c.state === 'failure'), pending: all.filter((c) => c.state === 'pending').map((c) => c.name), all,
    }
  }

  /** Resolvable discussions of a merge request. Thread ids are "<iid>:<discussion id>". */
  reviewThreads(number) {
    return this.pages(this.p(`merge_requests/${number}/discussions`), 5)
      .filter((d) => d.notes?.some((n) => n.resolvable))
      .map((d) => {
        const first = d.notes[0]
        return { id: `${number}:${d.id}`, resolved: d.notes.filter((n) => n.resolvable).every((n) => n.resolved), outdated: false, path: first.position?.new_path ?? null, line: first.position?.new_line ?? null, comments: d.notes.filter((n) => !n.system).map((n) => ({ author: n.author?.username ?? null, body: n.body, url: null, at: n.created_at })) }
      })
  }

  replyToThread(threadId, body, { resolve = false, dryRun = false } = {}) {
    const [iid, discussion] = String(threadId).split(':')
    if (!discussion) throw new CliError(`"${threadId}" is not a GitLab thread id (<merge request>:<discussion>)`, { hint: 'agent-os pr threads' })
    const requests = [{ method: 'POST', path: this.p(`merge_requests/${iid}/discussions/${discussion}/notes`), body: { body } }, ...(resolve ? [{ method: 'PUT', path: this.p(`merge_requests/${iid}/discussions/${discussion}?resolved=true`) }] : [])]
    if (dryRun) return { dryRun: true, requests }
    for (const r of requests) this.api.rest(r.method, r.path, r.body)
    return { threadId, url: null, resolved: resolve }
  }

  mergePullRequest(number, { method = 'squash', sha, title }, { dryRun = false } = {}) {
    const request = { method: 'PUT', path: this.p(`merge_requests/${number}/merge`), body: { squash: method === 'squash', ...(sha ? { sha } : {}), ...(title && method === 'squash' ? { squash_commit_message: `${title} (!${number})` } : {}) } }
    if (dryRun) return { dryRun: true, requests: [request] }
    const mr = this.api.rest(request.method, request.path, request.body)
    return { number, merged: mr?.state === 'merged', sha: mr?.squash_commit_sha ?? mr?.merge_commit_sha ?? null }
  }

  deleteBranch(branch, { dryRun = false } = {}) {
    const request = { method: 'DELETE', path: this.p(`repository/branches/${encodeURIComponent(branch)}`) }
    if (dryRun) return { dryRun: true, requests: [request] }
    try { this.api.rest(request.method, request.path) } catch (err) {
      if (/HTTP 404|Branch Not Found/i.test(err.output ?? err.message)) return { branch, deleted: false, already: true }
      throw err
    }
    return { branch, deleted: true }
  }
}
