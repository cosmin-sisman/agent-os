// Which code platform a repository lives on: parse the git remote, recognize github.com and gitlab.com, and probe
// any other host (GitHub Enterprise Server or GitLab self-managed / Dedicated). An unknown host is reported, never guessed.

import { execFileSync } from 'node:child_process'

/**
 * Parses a git remote URL: https://host/owner/repo(.git), ssh://git@host:2222/group/sub/repo.git, git@host:owner/repo.git.
 * @returns {{ host: string, project: string, scheme: 'https' | 'http' | 'ssh' } | null}
 */
export function parseRemote(url) {
  const u = String(url).trim()
  let m = u.match(/^(https?):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/)
  if (m) return { scheme: m[1], host: m[2].toLowerCase(), project: m[3] }
  m = u.match(/^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/)
  if (m) return { scheme: 'ssh', host: m[1].toLowerCase(), project: m[2] }
  m = u.match(/^(?:[^@/]+@)?([^/:]+):(?!\d+\/)(.+?)(?:\.git)?\/?$/)
  if (m) return { scheme: 'ssh', host: m[1].toLowerCase(), project: m[2] }
  return null
}

/** The URL of a git remote in `cwd`, or null. */
export function remoteUrl(cwd, name = 'origin') {
  try {
    return execFileSync('git', ['remote', 'get-url', name], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}

const KNOWN = {
  'github.com': { type: 'github', edition: 'cloud' },
  'gitlab.com': { type: 'gitlab', edition: 'cloud' },
}

async function get(fetchFn, url, timeoutMs) {
  try {
    const res = await fetchFn(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' })
    let body = null
    try { body = await res.json() } catch {}
    return { status: res.status, headers: res.headers, body }
  } catch (err) {
    return { error: err?.cause?.code ?? err?.name ?? 'network error' }
  }
}

/**
 * Identifies a host that is neither github.com nor gitlab.com by asking it. Nothing is sent but two anonymous GET
 * requests; no token is used. A private CA must be trusted by Node (NODE_EXTRA_CA_CERTS=<platform.caFile>).
 * @param {string} host
 * @param {{ fetchFn?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<{ type: 'github' | 'gitlab' | null, edition?: string, version?: string | null, evidence: string }>}
 */
export async function probeHost(host, { fetchFn = fetch, timeoutMs = 5000 } = {}) {
  const base = `https://${host}`
  const gh = await get(fetchFn, `${base}/api/v3/meta`, timeoutMs)
  const ghVersion = gh.headers?.get?.('x-github-enterprise-version') ?? gh.body?.installed_version ?? null
  if (gh.status === 200 && (ghVersion || gh.body?.verifiable_password_authentication !== undefined)) {
    return { type: 'github', edition: 'enterprise-server', version: ghVersion, evidence: `${base}/api/v3/meta answered as GitHub Enterprise Server` }
  }
  const gl = await get(fetchFn, `${base}/api/v4/version`, timeoutMs)
  if (gl.status === 200 && typeof gl.body?.version === 'string') {
    return { type: 'gitlab', edition: 'self-managed', version: gl.body.version, evidence: `${base}/api/v4/version reported GitLab ${gl.body.version}` }
  }
  if (gl.status === 401 && (/401 Unauthorized/.test(gl.body?.message ?? '') || gl.headers?.get?.('x-gitlab-meta'))) {
    return { type: 'gitlab', edition: 'self-managed', version: null, evidence: `${base}/api/v4/version answered like GitLab (401 without a token; the version is read after login)` }
  }
  const reasons = [gh, gl].map((r, i) => `${i ? '/api/v4/version' : '/api/v3/meta'}: ${r.error ?? `HTTP ${r.status}`}`).join(', ')
  return { type: null, evidence: `${host} is neither GitHub nor GitLab as far as it answered (${reasons})` }
}

/**
 * Proposes a platform configuration for a repository from its remote.
 * @param {{ remote: string | null, fetchFn?: typeof fetch }} input
 * @returns {Promise<{ ok: boolean, platform?: object, edition?: string, version?: string | null, evidence: string }>}
 */
export async function detectPlatform({ remote, fetchFn }) {
  if (!remote) return { ok: false, evidence: 'this repository has no "origin" remote; set platform.type, host and project by hand' }
  const parsed = parseRemote(remote)
  if (!parsed) return { ok: false, evidence: `the remote "${remote.replace(/\/\/[^@/]+@/, '//***@')}" is not a URL agent-os can read` }
  const known = KNOWN[parsed.host]
  if (known) return { ok: true, platform: { type: known.type, project: parsed.project }, edition: known.edition, version: null, evidence: `the remote is on ${parsed.host}` }
  const probe = await probeHost(parsed.host, { fetchFn })
  if (!probe.type) return { ok: false, evidence: probe.evidence }
  return { ok: true, platform: { type: probe.type, host: `https://${parsed.host}`, project: parsed.project }, edition: probe.edition, version: probe.version, evidence: probe.evidence }
}

/** The login command for a platform and host; agent-os never handles the token itself. */
export function loginCommand(platform) {
  const host = platform.host ? new URL(platform.host).host : platform.type === 'gitlab' ? 'gitlab.com' : 'github.com'
  return platform.type === 'gitlab' ? `glab auth login --hostname ${host}` : `gh auth login --hostname ${host}`
}
