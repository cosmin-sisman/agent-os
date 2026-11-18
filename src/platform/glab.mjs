// The GitLab client over the glab CLI (`glab api`): REST v4 with JSON in and out, GraphQL, retries on rate limits
// (HTTP 429) and temporary server errors. Used by capability probing and by the GitLab tracker. Tests replace the
// runner with a fake.

import { spawnSync } from 'node:child_process'
import { CliError } from '../cli/errors.mjs'

export function systemGlab(args, { input } = {}) {
  const r = spawnSync(process.platform === 'win32' ? 'glab.exe' : 'glab', args, { input, encoding: 'utf8', timeout: 60000, windowsHide: true })
  if (r.error?.code === 'ENOENT') throw new CliError('the GitLab CLI (glab) is not installed', { hint: 'install it from https://gitlab.com/gitlab-org/cli, then run "glab auth login --hostname <host>"' })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const RETRYABLE = /HTTP 429|Too Many Requests|rate limit|HTTP 50[234]|try again/i
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * @param {(args: string[], opts?: { input?: string }) => { status: number, stdout: string, stderr: string }} run
 * @param {{ host?: string, retries?: number, backoffMs?: number }} [options]
 */
export function glabClient(run = systemGlab, { host, retries = 4, backoffMs = 500 } = {}) {
  const hostArgs = host ? ['--hostname', host] : []
  function call(args, input) {
    for (let attempt = 0; ; attempt++) {
      const r = run([...args, ...hostArgs], { input })
      if (r.status === 0) return r.stdout.trim() ? JSON.parse(r.stdout) : null
      const out = `${r.stderr}\n${r.stdout}`
      if (attempt < retries && RETRYABLE.test(out)) { sleep(backoffMs * 2 ** attempt); continue }
      const e = new CliError(`GitLab API: ${(r.stderr || r.stdout).trim().split('\n')[0] || `glab exited ${r.status}`}`)
      e.output = out
      throw e
    }
  }
  const rest = (method, path, body) => call(['api', '--method', method, path, ...(body === undefined ? [] : ['--header', 'Content-Type: application/json', '--input', '-'])], body === undefined ? undefined : JSON.stringify(body))
  return {
    rest,
    /** GET, kept for the capability probe. */
    get: (path) => rest('GET', path),
    graphql: (query, variables = {}) => {
      const data = call(['api', '--method', 'POST', 'graphql', '--header', 'Content-Type: application/json', '--input', '-'], JSON.stringify({ query, variables }))
      if (data?.errors?.length) {
        const e = new CliError(`GitLab GraphQL: ${data.errors[0].message}`)
        e.output = JSON.stringify(data.errors)
        throw e
      }
      return data?.data ?? data
    },
  }
}
