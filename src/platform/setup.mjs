// Chooses the setup planner for the configured platform. GitLab's planner is #93.

import { CliError } from '../cli/errors.mjs'
import { planGitHubSetup } from './setup-github.mjs'
import { ghClient } from '../tracker/gh.mjs'

export const SETUP_AREAS = ['branches', 'ruleset', 'labels', 'milestones', 'files']

/** Remote setup steps (branches, ruleset, labels, milestones) for the configured platform. */
export function planPlatformSetup(config, { gh, only } = {}) {
  if (config.platform?.type === 'gitlab') throw new CliError('GitLab setup is planned but not implemented yet', { hint: 'follow #93: https://github.com/cosmin-sisman/agent-os/issues/93' })
  if (!config.platform?.project) throw new CliError('platform.project is not set', { hint: 'run "agent-os platform detect --write" first' })
  const host = config.platform.host ? new URL(config.platform.host).host : 'github.com'
  return planGitHubSetup(config, ghClient(gh, { host }), { only })
}
