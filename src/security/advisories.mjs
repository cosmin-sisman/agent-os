// The advisory watch's network access, in one module (the only place in src that sends requests of its own; the
// no-network test names it as the exception). It asks OSV.dev (which includes the GitHub and GitLab advisory
// databases) about the project's packages and reads CISA's Known Exploited Vulnerabilities catalog. Only package
// names, ecosystems and versions leave the project: never code, paths or the repository's name.
//
// Requests run in a child Node process that gets the project's network settings (platform.caFile, machine.proxy,
// through the same variables as #95), since a running Node process cannot take a new CA or proxy. Tests inject
// `fetch` instead. On a self-managed host the watch is off unless security.advisories.enabled is true, and a mirror
// (security.advisories.osvUrl, kevUrl) replaces the public endpoints for air-gapped installs.

import { spawnSync } from 'node:child_process'
import { CliError } from '../cli/errors.mjs'
import { networkEnv } from '../platform/network.mjs'

export const OSV_URL = 'https://api.osv.dev/v1/querybatch'
export const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'
const BATCH = 500

/** Whether the watch may send requests, and where; { enabled, why, osvUrl, kevUrl }. */
export function watchSettings(config) {
  const a = config.security?.advisories ?? {}
  const enabled = a.enabled ?? !config.platform?.host
  return {
    enabled,
    why: enabled ? null : a.enabled === false ? 'security.advisories.enabled is false' : 'off by default on a self-managed host (set security.advisories.enabled: true, with osvUrl and kevUrl for an internal mirror)',
    osvUrl: a.osvUrl ?? OSV_URL,
    kevUrl: a.kevUrl ?? KEV_URL,
  }
}

/** The requests the watch would send for these packages: exactly what leaves the project. */
export function plannedRequests(packages, settings) {
  const queries = packages.map((p) => ({ package: { name: p.name, ecosystem: p.ecosystem }, version: p.version }))
  const batches = []
  for (let i = 0; i < queries.length; i += BATCH) batches.push({ method: 'POST', url: settings.osvUrl, body: { queries: queries.slice(i, i + BATCH) } })
  return [...batches, { method: 'GET', url: settings.kevUrl, body: null }]
}

/** A fetch that runs in a child Node process with the project's CA and proxy (and Node's env-proxy support on). */
export function childFetch(config, cwd, { timeoutMs = 60000 } = {}) {
  const env = { ...process.env, ...networkEnv(config, cwd), NODE_USE_ENV_PROXY: '1' }
  const script = "let s='';process.stdin.on('data',(d)=>s+=d).on('end',async()=>{const r=JSON.parse(s);try{const res=await fetch(r.url,{method:r.method,headers:r.body?{'content-type':'application/json'}:{},body:r.body?JSON.stringify(r.body):undefined,signal:AbortSignal.timeout(" + timeoutMs + ")});const t=await res.text();process.stdout.write(JSON.stringify({status:res.status,text:t}))}catch(e){process.stdout.write(JSON.stringify({error:String(e&&e.message||e)}))}})"
  return async (req) => {
    const r = spawnSync(process.execPath, ['-e', script], { input: JSON.stringify(req), env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true, timeout: timeoutMs + 5000 })
    let out
    try { out = JSON.parse(r.stdout || '{}') } catch { out = { error: (r.stderr || 'no answer').trim().split('\n')[0] } }
    if (out.error || r.status) throw new CliError(`${req.method} ${req.url} failed: ${out.error ?? `exit ${r.status}`}`, { hint: 'check the network, machine.proxy and platform.caFile (agent-os env); on an air-gapped install set security.advisories.osvUrl and kevUrl to a mirror' })
    if (out.status >= 400) throw new CliError(`${req.method} ${req.url} answered HTTP ${out.status}`)
    return JSON.parse(out.text)
  }
}

/**
 * Asks the sources and returns { vulns: { id, aliases, summary, severity, packages: [{ ecosystem, name, version }],
 * fixed, kev }[] }. `fetch(request)` resolves to the parsed JSON body.
 */
export async function queryAdvisories(packages, { fetch, settings }) {
  const reqs = plannedRequests(packages, settings)
  const byId = new Map()
  const queries = reqs.filter((r) => r.method === 'POST').flatMap((r) => r.body.queries)
  let offset = 0
  for (const req of reqs.filter((r) => r.method === 'POST')) {
    const res = await fetch(req)
    for (const [i, result] of (res?.results ?? []).entries()) {
      const q = queries[offset + i]
      for (const v of result?.vulns ?? []) {
        const e = byId.get(v.id) ?? { id: v.id, aliases: v.aliases ?? [], summary: v.summary ?? '', severity: severityOf(v), packages: [], fixed: fixedOf(v, q), kev: false }
        e.packages.push({ ecosystem: q.package.ecosystem, name: q.package.name, version: q.version })
        byId.set(v.id, e)
      }
    }
    offset += req.body.queries.length
  }
  const kev = await fetch(reqs.at(-1))
  const exploited = new Set((kev?.vulnerabilities ?? []).map((k) => k.cveID))
  for (const v of byId.values()) v.kev = [v.id, ...v.aliases].some((a) => exploited.has(a))
  return { vulns: [...byId.values()] }
}

const LEVELS = ['critical', 'high', 'moderate', 'medium', 'low']
function severityOf(v) {
  const s = String(v.database_specific?.severity ?? '').toLowerCase()
  if (LEVELS.includes(s)) return s === 'medium' ? 'moderate' : s
  const score = Number(String(v.severity?.find?.((x) => /CVSS/.test(x.type))?.score ?? '').match(/^\d+(\.\d+)?$/)?.[0])
  if (Number.isFinite(score)) return score >= 9 ? 'critical' : score >= 7 ? 'high' : score >= 4 ? 'moderate' : 'low'
  return 'unknown'
}
function fixedOf(v, q) {
  const fixes = (v.affected ?? []).filter((a) => a.package?.name === q?.package?.name).flatMap((a) => (a.ranges ?? []).flatMap((r) => (r.events ?? []).map((e) => e.fixed).filter(Boolean)))
  return fixes[0] ?? null
}
