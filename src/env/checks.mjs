// Environment checks: does this repository declare what the project needs (repo side), and does this laptop have it
// (laptop side)? Every finding says what is wrong and the exact command that fixes it. Secret values are never
// read into findings: only names, presence, scopes and where a value comes from.

import { networkProblems } from '../platform/network.mjs'
import { join } from 'node:path'
import { extractVersion, satisfies } from './semver.mjs'

/**
 * @typedef {object} Finding
 * @property {'repo' | 'laptop'} side
 * @property {'ok' | 'warn' | 'fail'} level
 * @property {string} message never contains a secret value
 * @property {string} [fix] the command or edit that fixes it
 */

const SECRET_KEY = /(token|secret|passw(or)?d|api[_-]?key|auth|credential|private[_-]?key|cookie|session)/i
const PLACEHOLDER = /^(Bearer\s+|token\s+)?(\$\{[A-Za-z_][A-Za-z0-9_]*(:-[^}]*)?\}|\$[A-Za-z_][A-Za-z0-9_]*)$/i
const TOKEN_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/, /\bglpat-[A-Za-z0-9_-]{20,}/, /\bsk-(ant-)?[A-Za-z0-9_-]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, /\bAKIA[0-9A-Z]{16}\b/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
]

/** True when a value looks like a real credential rather than a ${VAR} placeholder. */
export function isLiteralSecret(key, value) {
  if (typeof value !== 'string' || value.trim() === '') return false
  if (TOKEN_PATTERNS.some((re) => re.test(value))) return true
  return SECRET_KEY.test(key) && !PLACEHOLDER.test(value.trim())
}

/** Every literal secret in an .mcp.json document, as JSON paths (the values are not returned). */
export function literalSecrets(mcp) {
  const found = []
  const walk = (value, path, key) => {
    if (typeof value === 'string') { if (isLiteralSecret(key, value)) found.push(path); return }
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`, key))
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k, k)
  }
  walk(mcp, '', '')
  return found
}

const transportOf = (server) => server?.type ?? (server?.command ? 'stdio' : server?.url ? 'http' : 'stdio')

/** The `claude mcp add` command that adds a required server, as precisely as the requirement allows. */
export function addCommand(req) {
  const scope = `--scope ${req.scope}`
  if (req.transport && req.transport !== 'stdio') return `claude mcp add ${scope} --transport ${req.transport} ${req.name} ${req.url ?? '<url>'}`
  return `claude mcp add ${scope} ${req.name} -- ${req.command ?? '<command that starts the server>'}`
}

// ── Repo side ──────────────────────────────────────────────────────────────

/** .mcp.json declares every project server with its transport, and holds no literal secrets. */
export function checkRepo(config, { cwd, probe }) {
  const findings = []
  const raw = probe.read(join(cwd, '.mcp.json'))
  const projectServers = (config.requires?.mcp ?? []).filter((s) => s.scope === 'project')
  let mcp = null
  if (raw !== null) {
    try { mcp = JSON.parse(raw) } catch { findings.push({ side: 'repo', level: 'fail', message: '.mcp.json is not valid JSON', fix: 'fix the syntax in .mcp.json' }) }
  }
  for (const req of projectServers) {
    const server = mcp?.mcpServers?.[req.name]
    const level = req.optional ? 'warn' : 'fail'
    if (!server) findings.push({ side: 'repo', level, message: `.mcp.json does not declare the ${req.optional ? 'optional ' : ''}project MCP server "${req.name}"${req.why ? ` (${req.why})` : ''}`, fix: addCommand(req) })
    else if (req.transport && transportOf(server) !== req.transport) findings.push({ side: 'repo', level, message: `.mcp.json: "${req.name}" uses ${transportOf(server)}, the project expects ${req.transport}`, fix: `${addCommand(req)}   (after: claude mcp remove --scope project ${req.name})` })
    else findings.push({ side: 'repo', level: 'ok', message: `.mcp.json declares "${req.name}" (${transportOf(server)})` })
  }
  for (const p of networkProblems(config, cwd)) findings.push({ side: 'repo', ...p })
  if (mcp) {
    for (const path of literalSecrets(mcp)) {
      const name = path.split(/[.[\]]/).filter(Boolean).at(-1)
      findings.push({ side: 'repo', level: 'fail', message: `.mcp.json: ${path} holds a literal secret (value not shown)`, fix: `replace it with "\${${/^[A-Za-z_]\w*$/.test(name) && !/^\d+$/.test(name) ? name.toUpperCase() : 'SECRET_NAME'}}" and set that variable on each laptop; rotate the exposed secret` })
    }
  }
  return findings
}

// ── Laptop side ────────────────────────────────────────────────────────────

/** Required variables are set (only presence is checked; values are never read). */
export function checkEnvVars(config, { probe }) {
  return (config.requires?.env ?? []).map((name) => (probe.hasEnv(name)
    ? { side: 'laptop', level: 'ok', message: `${name} is set` }
    : { side: 'laptop', level: 'fail', message: `${name} is not set (value never shown)`, fix: `set ${name} in your shell profile or secret manager` }))
}

/** Parses `claude mcp list` lines: "name: target - ✔ Connected". */
export function parseMcpList(text) {
  const servers = {}
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^(.+?):\s.*\s-\s(.+)$/)
    if (!m) continue
    const status = m[2].trim()
    servers[m[1].trim()] = /connected/i.test(status) && !/fail|not/i.test(status) ? 'connected' : /auth/i.test(status) ? 'needs-auth' : 'failed'
  }
  return servers
}

/** Required MCP servers are installed and connected on this laptop. */
export function checkMcpServers(config, { probe }) {
  const required = config.requires?.mcp ?? []
  if (!required.length) return []
  const r = probe.run('claude', ['mcp', 'list'], { timeoutMs: 30000 })
  if (!r.found) return [{ side: 'laptop', level: 'fail', message: 'the claude CLI is not installed, so MCP servers cannot be checked', fix: 'install Claude Code: https://docs.claude.com/en/docs/claude-code' }]
  if (r.status !== 0) return [{ side: 'laptop', level: 'warn', message: `claude mcp list failed (exit ${r.status}); MCP servers were not checked`, fix: 'run "claude mcp list" to see why' }]
  const servers = parseMcpList(r.stdout)
  return required.map((req) => {
    const state = servers[req.name]
    const level = req.optional ? 'warn' : 'fail'
    if (!state) return { side: 'laptop', level, message: `MCP server "${req.name}" is not installed (${req.scope} scope)${req.why ? `: ${req.why}` : ''}`, fix: req.scope === 'project' ? 'open the project in Claude Code and approve the project servers, or run: ' + addCommand(req) : addCommand(req) }
    if (state === 'needs-auth') return { side: 'laptop', level, message: `MCP server "${req.name}" needs authentication`, fix: 'in Claude Code, run /mcp and authenticate it' }
    if (state === 'failed') return { side: 'laptop', level, message: `MCP server "${req.name}" fails to connect`, fix: `claude mcp get ${req.name}` }
    return { side: 'laptop', level: 'ok', message: `MCP server "${req.name}" is connected` }
  })
}

/** Required command-line tools are installed in a version within their range. */
export function checkCli(config, { probe }) {
  return Object.entries(config.requires?.cli ?? {}).map(([name, range]) => {
    const r = probe.run(name, ['--version'])
    if (!r.found) return { side: 'laptop', level: 'fail', message: `${name} is not installed (needs ${range})`, fix: `install ${name} ${range}` }
    const version = extractVersion(`${r.stdout}\n${r.stderr}`)
    if (!version) return { side: 'laptop', level: 'warn', message: `${name} is installed but its version could not be read (needs ${range})` }
    const v = version.join('.')
    let ok
    try { ok = satisfies(version, range) } catch (err) { return { side: 'laptop', level: 'fail', message: `requires.cli.${name}: ${err.message}`, fix: 'fix the range in agent-os.json' } }
    return ok ? { side: 'laptop', level: 'ok', message: `${name} ${v} (needs ${range})` } : { side: 'laptop', level: 'fail', message: `${name} ${v} is installed, the project needs ${range}`, fix: `upgrade ${name} to ${range}` }
  })
}

/** Scopes from `gh auth status` output; the token line itself is ignored. */
export function parseScopes(text) {
  const m = String(text).match(/Token scopes:\s*(.*)/i)
  return m ? m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : null
}

/** The platform CLI is installed and logged in, with the scopes the project needs. */
export function checkPlatformAuth(config, { probe }) {
  const type = config.platform?.type ?? 'github'
  const host = config.platform?.host ? new URL(config.platform.host).host : type === 'gitlab' ? 'gitlab.com' : 'github.com'
  const cli = type === 'gitlab' ? 'glab' : 'gh'
  const needed = config.requires?.platformScopes ?? []
  const r = probe.run(cli, ['auth', 'status', '--hostname', host])
  if (!r.found) return [{ side: 'laptop', level: 'fail', message: `${cli} is not installed`, fix: type === 'gitlab' ? 'install glab: https://gitlab.com/gitlab-org/cli' : 'install gh: https://cli.github.com' }]
  const text = `${r.stdout}\n${r.stderr}`
  if (r.status !== 0 || !/logged in/i.test(text)) return [{ side: 'laptop', level: 'fail', message: `${cli} is not logged in to ${host}`, fix: `${cli} auth login --hostname ${host}` }]
  const scopes = parseScopes(text)
  const source = `${cli} auth (${host})`
  if (!needed.length) return [{ side: 'laptop', level: 'ok', message: `${source}: logged in` }]
  if (!scopes) return [{ side: 'laptop', level: 'warn', message: `${source}: logged in, but its token scopes cannot be read; make sure it has: ${needed.join(', ')}` }]
  const missing = needed.filter((s) => !scopes.includes(s))
  if (!missing.length) return [{ side: 'laptop', level: 'ok', message: `${source}: logged in with ${needed.join(', ')}` }]
  return [{
    side: 'laptop', level: 'fail', message: `${source}: the token lacks ${missing.join(', ')} (has: ${scopes.join(', ') || 'none'})`,
    fix: type === 'gitlab' ? `glab auth login --hostname ${host}   (with a token that has ${missing.join(', ')})` : `gh auth refresh -h ${host} -s ${missing.join(',')}`,
  }]
}

// ── All of it ──────────────────────────────────────────────────────────────

/**
 * Runs the checks for a mode: `fast` (repo side and variables, no commands: for SessionStart), `ci` (repo side only)
 * or `full` (everything).
 * @returns {{ mode: string, findings: Finding[], summary: { ok: number, warn: number, fail: number } }}
 */
export function checkEnvironment(config, { cwd, probe, mode = 'full' }) {
  const findings = [
    ...checkRepo(config, { cwd, probe }),
    ...(mode === 'ci' ? [] : checkEnvVars(config, { probe })),
    ...(mode === 'full' ? [...checkPlatformAuth(config, { probe }), ...checkCli(config, { probe }), ...checkMcpServers(config, { probe })] : []),
  ]
  const summary = { ok: 0, warn: 0, fail: 0 }
  for (const f of findings) summary[f.level]++
  return { mode, findings, summary }
}
