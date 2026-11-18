// Chooses the setup planner for the configured platform.

import { CliError } from '../cli/errors.mjs'
import { planGitHubSetup } from './setup-github.mjs'
import { ghClient } from '../tracker/gh.mjs'
import { planGitLabSetup } from './setup-gitlab.mjs'
import { glabClient } from './glab.mjs'

export const SETUP_AREAS = ['branches', 'ruleset', 'labels', 'milestones', 'files']

/** Remote setup steps (branches, ruleset, labels, milestones) for the configured platform. */
export function planPlatformSetup(config, { gh, glab, only } = {}) {
  if (!config.platform?.project) throw new CliError('platform.project is not set', { hint: 'run "agent-os platform detect --write" first' })
  if (config.platform.type === 'gitlab') {
    const host = config.platform.host ? new URL(config.platform.host).host : undefined
    return planGitLabSetup(config, glabClient(glab, { host }), { only })
  }
  const host = config.platform.host ? new URL(config.platform.host).host : 'github.com'
  return planGitHubSetup(config, ghClient(gh, { host }), { only })
}
