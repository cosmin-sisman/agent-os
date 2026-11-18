// The GitHub adapter's change requests, tags, releases, milestones and review threads, mixed into GitHubTracker.

import { CliError } from '../cli/errors.mjs'
import { CONTEXTS, checksOf } from './github-shared.mjs'

/** Mixed into GitHubTracker (github.mjs): the same `this` and the same interface. */
export class ChangeRequestMethods {
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

  /**
   * A vulnerability, reported privately (#111): a draft repository security advisory, visible only to the
   * maintainers until they publish it. It never falls back to a public issue: without the rights, it fails.
   */
  reportVulnerability({ title, body, severity, pkg }, { dryRun = false } = {}) {
    const request = {
      summary: title,
      description: body || title,
      ...(severity ? { severity } : {}),
      vulnerabilities: [{ package: { ecosystem: pkg?.ecosystem ?? 'other', name: pkg?.name ?? this.repo }, vulnerable_version_range: null, patched_versions: null, vulnerable_functions: [] }],
    }
    const path = `repos/${this.repo}/security-advisories`
    if (dryRun) return { dryRun: true, channel: 'draft security advisory', requests: [{ method: 'POST', path, body: request }] }
    let r
    try { r = this.gh.rest('POST', path, request) } catch (err) {
      throw new CliError(`the draft security advisory was not created: ${err.message}`, { hint: 'it needs a maintainer with admin or security manager rights on the repository; nothing was filed publicly' })
    }
    return { channel: 'draft security advisory', id: r.ghsa_id ?? null, url: r.html_url ?? null, state: r.state ?? 'draft' }
  }
}
