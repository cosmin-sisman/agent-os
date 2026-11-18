// A minimal GitLab client over the glab CLI (`glab api`), for capability probing. The full GitLab adapter is #92.

import { spawnSync } from 'node:child_process'
import { CliError } from '../cli/errors.mjs'

export function systemGlab(args) {
  const r = spawnSync(process.platform === 'win32' ? 'glab.exe' : 'glab', args, { encoding: 'utf8', timeout: 30000, windowsHide: true })
  if (r.error?.code === 'ENOENT') throw new CliError('the GitLab CLI (glab) is not installed', { hint: 'install it from https://gitlab.com/gitlab-org/cli, then run "glab auth login --hostname <host>"' })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** GET helper: `glab api <path>` against the configured host. Errors carry the output, which names the HTTP status. */
export function glabClient(run = systemGlab, { host } = {}) {
  return {
    get(path) {
      const r = run(['api', path, ...(host ? ['--hostname', host] : [])])
      if (r.status === 0) return r.stdout.trim() ? JSON.parse(r.stdout) : null
      const e = new CliError(`GitLab API: ${(r.stderr || r.stdout).trim().split('\n')[0]}`)
      e.output = `${r.stderr}\n${r.stdout}`
      throw e
    },
  }
}
