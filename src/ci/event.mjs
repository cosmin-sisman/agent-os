// The change request a CI job runs for, read from files and variables rather than interpolated into a script:
// GitHub Actions' event file, or GitLab's merge request variables. Shared by the loop check and the gate.

import { readFileSync } from 'node:fs'
import { CliError } from '../cli/errors.mjs'

/**
 * The change request from the CI environment, read from files and variables rather than interpolated into a script:
 * GitHub Actions' event file, or GitLab's merge request variables.
 */
export function fromCi(env, { allowPush = false } = {}) {
  if (env.GITHUB_EVENT_PATH) {
    let event
    try { event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) } catch { throw new CliError('cannot read the GitHub event file', { hint: 'run this in a pull_request workflow' }) }
    const pr = event.pull_request
    if (!pr) {
      if (allowPush) return { push: true, body: '', author: event.sender?.login ?? null, base: null, ref: String(event.ref ?? '').replace(/^refs\/heads\//, '') || null }
      throw new CliError('this GitHub event has no pull request', { hint: 'run the loop check on pull_request events' })
    }
    return { body: pr.body ?? '', author: pr.user?.login ?? null, base: pr.base?.ref ?? null }
  }
  if (env.GITLAB_CI) {
    if (!env.CI_MERGE_REQUEST_IID) {
      if (allowPush) return { push: true, body: '', author: env.GITLAB_USER_LOGIN ?? null, base: null, ref: env.CI_COMMIT_BRANCH ?? null }
      throw new CliError('this GitLab pipeline is not a merge request pipeline', { hint: 'run the loop check with rules: if: $CI_PIPELINE_SOURCE == "merge_request_event"' })
    }
    return { body: env.CI_MERGE_REQUEST_DESCRIPTION ?? '', author: env.GITLAB_USER_LOGIN ?? null, base: env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME ?? null }
  }
  throw new CliError('--from-ci found neither GitHub Actions nor GitLab CI', { hint: 'pass --body-file instead' })
}
