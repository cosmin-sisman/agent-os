// The tracker adapter for GitHub: issues, sub-issues, dependencies, assignees, linked branches, the planning board
// (Projects v2) and milestone progress, through `gh api`. Every mutating operation accepts { dryRun } and then
// returns the request it would send instead of sending it. A missing `project` scope degrades to a warning.

import { CliError } from '../cli/errors.mjs'

const ALREADY = /already|duplicate sub-issues|already exists|has already been taken/i

/** An issue from the REST API, in the tracker's shape. */
const issueOf = (i) => ({ number: i.number, title: i.title, state: i.state, url: i.html_url, labels: (i.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)), milestone: i.milestone ? { title: i.milestone.title, dueOn: i.milestone.due_on ?? null } : null, assignees: (i.assignees ?? []).map((a) => a.login) })

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
    return { number: i.number, title: i.title, state: i.state, url: i.html_url, labels: i.labels.map((l) => l.name), milestone: i.milestone?.title ?? null, assignees: i.assignees.map((a) => a.login), isPullRequest: Boolean(i.pull_request) }
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
    const q = 'query($q:String!){ search(query:$q, type:ISSUE, first:50){ nodes{ ... on PullRequest { number title url isDraft reviewDecision commits(last:1){ nodes{ commit{ statusCheckRollup{ state } } } } } } } }'
    const nodes = this.gh.graphql(q, { q: `repo:${this.repo} is:pr is:open ${filter}` })?.search?.nodes ?? []
    return nodes.filter((n) => n?.number).map((n) => ({ number: n.number, title: n.title, url: n.url, draft: Boolean(n.isDraft), review: n.reviewDecision ?? null, checks: n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null }))
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

  /** The open pull request for a branch, or null. */
  pullRequestFor(branch) {
    const owner = this.repo.split('/')[0]
    const list = this.gh.rest('GET', `repos/${this.repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=1`) ?? []
    return list[0] ? { number: list[0].number, url: list[0].html_url } : null
  }

  /** Adds labels to an issue or pull request (the issues endpoint works for both). */
  addLabels(number, labels, { dryRun = false } = {}) {
    const request = { method: 'POST', path: `repos/${this.repo}/issues/${number}/labels`, body: { labels } }
    if (dryRun) return { dryRun: true, requests: [request] }
    if (labels.length) this.gh.rest(request.method, request.path, request.body)
    return { number, labels }
  }

  /** The state of a pull request: review decision and every check on its last commit. */
  pullRequestStatus(number) {
    const [owner, name] = this.repo.split('/')
    const q = 'query($o:String!,$n:String!,$p:Int!){ repository(owner:$o,name:$n){ pullRequest(number:$p){ number title body url state isDraft mergeable mergeStateStatus reviewDecision baseRefName headRefName isCrossRepository author{ login } commits(last:1){ nodes{ commit{ oid statusCheckRollup{ state contexts(first:100){ nodes{ __typename ... on CheckRun { name status conclusion detailsUrl } ... on StatusContext { context state targetUrl } } } } } } } } } }'
    const pr = this.gh.graphql(q, { o: owner, n: name, p: number })?.repository?.pullRequest
    if (!pr) throw new CliError(`pull request #${number} not found`)
    const commit = pr.commits?.nodes?.[0]?.commit
    const checks = (commit?.statusCheckRollup?.contexts?.nodes ?? []).map((c) => (c.__typename === 'StatusContext'
      ? { name: c.context, state: c.state === 'SUCCESS' ? 'success' : c.state === 'PENDING' || c.state === 'EXPECTED' ? 'pending' : 'failure', url: c.targetUrl ?? null }
      : { name: c.name, state: c.status !== 'COMPLETED' ? 'pending' : ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(c.conclusion) ? 'success' : 'failure', url: c.detailsUrl ?? null }))
    const overall = !checks.length ? 'none' : checks.some((c) => c.state === 'failure') ? 'failure' : checks.some((c) => c.state === 'pending') ? 'pending' : 'success'
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
