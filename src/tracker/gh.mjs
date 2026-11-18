// Calls the GitHub CLI for the tracker: `gh api` with JSON in and out, retries on rate limits and on the temporary
// conflicts Projects v2 returns under load. Tests replace the runner with a fake.

import { spawnSync } from 'node:child_process'
import { CliError } from '../cli/errors.mjs'

/** The real gh: returns { status, stdout, stderr }. */
export function systemGh(args, { input, env } = {}) {
  const r = spawnSync(process.platform === 'win32' ? 'gh.exe' : 'gh', args, { input, encoding: 'utf8', timeout: 60000, windowsHide: true, ...(env ? { env: { ...process.env, ...env } } : {}) })
  if (r.error?.code === 'ENOENT') throw new CliError('the GitHub CLI (gh) is not installed', { hint: 'install it from https://cli.github.com, then run "gh auth login"' })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const RETRYABLE = /rate limit|secondary|temporary conflict|try again|was submitted too quickly|HTTP 50[234]/i
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * Wraps a gh runner into REST and GraphQL helpers.
 * @param {(args: string[], opts?: { input?: string }) => { status: number, stdout: string, stderr: string }} run
 * @param {{ host?: string, retries?: number, backoffMs?: number }} [options]
 */
export function ghClient(run = systemGh, { host, retries = 4, backoffMs = 500 } = {}) {
  const hostArgs = host && host !== 'github.com' ? ['--hostname', host] : []
  function call(args, input) {
    for (let attempt = 0; ; attempt++) {
      const r = run([...args, ...hostArgs], { input })
      if (r.status === 0) return r.stdout.trim() ? JSON.parse(r.stdout) : null
      const err = `${r.stderr}\n${r.stdout}`
      if (attempt < retries && RETRYABLE.test(err)) { sleep(backoffMs * 2 ** attempt); continue }
      const e = new CliError(`GitHub API: ${(r.stderr || r.stdout).trim().split('\n')[0] || `gh exited ${r.status}`}`)
      e.output = err
      throw e
    }
  }
  return {
    /** REST call; `body` is sent as JSON. */
    rest: (method, path, body) => call(['api', '--method', method, path, ...(body === undefined ? [] : ['--input', '-'])], body === undefined ? undefined : JSON.stringify(body)),
    /** GraphQL call. */
    graphql: (query, variables = {}) => {
      const data = call(['api', 'graphql', '--input', '-'], JSON.stringify({ query, variables }))
      if (data?.errors?.length) throw new CliError(`GitHub GraphQL: ${data.errors[0].message}`)
      return data?.data
    },
    /** Any other gh command (for example `gh issue develop`), returning stdout. */
    raw: (args) => {
      const r = run([...args, ...(args[0] === 'api' ? hostArgs : [])])
      if (r.status !== 0) throw new CliError(`gh ${args.slice(0, 2).join(' ')}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`)
      return r.stdout
    },
  }
}
