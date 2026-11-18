// The tracker interface skills use instead of composing platform commands: one factory that returns the adapter for
// the configured platform. GitHub is implemented here; GitLab comes with #92.
//
// Interface (every write takes { dryRun } and then returns { dryRun: true, requests } without sending anything):
//   get(n) · children(n) · blockers(n) · progress(milestone?)
//   create(spec) · update(n, changes) · setParent(child, parent) · addBlocker(n, blocker) · assign(n, logins)
//   linkBranch(n, { branch, base }) · setStatus(n, value, { field })
//   warnings: string[] (for example a board skipped for a missing scope)

import { CliError } from '../cli/errors.mjs'
import { GitHubTracker } from './github.mjs'
import { ghClient } from './gh.mjs'

/**
 * @param {object} config merged configuration
 * @param {{ gh?: Function }} [deps] a fake gh runner in tests
 */
export function createTracker(config, { gh } = {}) {
  const p = config.platform ?? {}
  if (p.type === 'gitlab') throw new CliError('the GitLab tracker is planned but not implemented yet', { hint: 'follow #92: https://github.com/cosmin-sisman/agent-os/issues/92' })
  const host = p.host ? new URL(p.host).host : 'github.com'
  return new GitHubTracker({ repo: p.project, host, board: p.board }, ghClient(gh, { host }))
}
