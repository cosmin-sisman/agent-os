// The tracker adapter for GitHub: issues, sub-issues, dependencies, assignees, linked branches, the planning board
// (Projects v2) and milestone progress, through `gh api`. Every mutating operation accepts { dryRun } and then
// returns the request it would send instead of sending it. A missing `project` scope degrades to a warning.

import { CliError } from '../cli/errors.mjs'

const ALREADY = /already|duplicate sub-issues|already exists|has already been taken/i

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
