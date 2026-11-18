// The tracker interface skills use instead of composing platform commands: one factory that returns the adapter for
// the configured platform: GitHub (github.mjs) or GitLab (gitlab.mjs), with the same methods and result shapes.
//
// Interface (every write takes { dryRun } and then returns { dryRun: true, requests } without sending anything):
//   get(n) · children(n) · blockers(n) · progress(milestone?)
//   create(spec) · update(n, changes) · setParent(child, parent) · addBlocker(n, blocker) · assign(n, logins)
//   linkBranch(n, { branch, base }) · setStatus(n, value, { field })
//   whoami() · openIssues() · recentlyClosed(login) · blocking(n) · search(q) · milestones()
//   pullRequests(filter) · pullRequestFor(branch) · pullRequestStatus(n) · createPullRequest(spec)
//   labelChangeRequest(n, labels) · commentChangeRequest(n, body) · reviewThreads(n) · replyToThread(id, body)
//   mergePullRequest(n, { method, sha }) · deleteBranch(branch)
//   warnings: string[] (for example a board skipped for a missing scope)

import { GitHubTracker } from './github.mjs'
import { ghClient } from './gh.mjs'
import { GitLabTracker } from './gitlab.mjs'
import { glabClient } from '../platform/glab.mjs'

/**
 * @param {object} config merged configuration
 * @param {{ gh?: Function, glab?: Function }} [deps] fake gh or glab runners in tests
 */
export function createTracker(config, { gh, glab } = {}) {
  const p = config.platform ?? {}
  if (p.type === 'gitlab') {
    const host = p.host ? new URL(p.host).host : undefined
    return new GitLabTracker({ project: p.project, host }, glabClient(glab, { host }))
  }
  const host = p.host ? new URL(p.host).host : 'github.com'
  return new GitHubTracker({ repo: p.project, host, board: p.board }, ghClient(gh, { host }))
}
