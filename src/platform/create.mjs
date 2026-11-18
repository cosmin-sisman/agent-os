// Creating a project's repository from the command line, for `agent-os install` (#264): per platform, its cloud host,
// the CLI that does it, how to read the login, and how to create a private repository and point origin at it.
// The only place that knows these differences; install asks through PLATFORM_CREATE, never by the platform's name.

import { resolve } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { systemGh } from '../tracker/gh.mjs'
import { systemGlab } from './glab.mjs'

const first = (r) => String(r.stderr || r.stdout).trim().split('\n')[0].slice(0, 300)

export const PLATFORM_CREATE = {
  github: {
    cloud: 'github.com',
    cli: 'gh',
    runner: (io) => io.gh ?? systemGh,
    /** The login, or null when gh is missing or logged out. */
    whoami(io, hostName) {
      const r = this.runner(io)(['api', 'user', '--jq', '.login', ...(hostName !== this.cloud ? ['--hostname', hostName] : [])])
      return r.status === 0 ? String(r.stdout).trim() || null : null
    },
    /** gh creates the repository and adds origin itself (--source --remote). */
    create(io, { cwd, hostName, project }) {
      const r = this.runner(io)(['repo', 'create', project, '--private', '--source', resolve(cwd), '--remote', 'origin'], hostName !== this.cloud ? { env: { GH_HOST: hostName } } : {})
      if (r.status !== 0) throw new CliError(`gh repo create failed: ${first(r)}`, { hint: 'check gh auth status, then run agent-os install again' })
      return { setsOrigin: true }
    },
  },
  gitlab: {
    cloud: 'gitlab.com',
    cli: 'glab',
    runner: (io) => io.glab ?? systemGlab,
    whoami(io, hostName) {
      const r = this.runner(io)(['api', 'user', ...(hostName !== this.cloud ? ['--hostname', hostName] : [])])
      try { return r.status === 0 ? JSON.parse(r.stdout).username ?? null : null } catch { return null }
    },
    /** glab may or may not set origin inside a repository; install adds it when it is missing. */
    create(io, { hostName, project }) {
      const r = this.runner(io)(['repo', 'create', project, '--private'], hostName !== this.cloud ? { env: { GITLAB_HOST: hostName } } : {})
      if (r.status !== 0) throw new CliError(`glab repo create failed: ${first(r)}`, { hint: `check glab auth status --hostname ${hostName}, then run agent-os install again` })
      return { setsOrigin: false }
    },
  },
}

/** The platform's creator, or a CliError naming the ones there are. */
export function creatorFor(type) {
  const c = PLATFORM_CREATE[type]
  if (!c) throw new CliError(`--platform must be one of ${Object.keys(PLATFORM_CREATE).join(', ')}, got "${type}"`)
  return c
}
