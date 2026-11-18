// The maintenance profile's audit (design §11, `maintenance`): dependencies with known advisories (from the last
// advisory watch, no network), secrets (scanner reports and tracked .env files), and licenses (from the lockfiles),
// turned into prioritized issue proposals. It is read-only: nothing is filed until the person confirms, through
// /ticket. One proposal per vulnerable package, so a package with five advisories is one issue, not five.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readCache } from '../security/digest.mjs'
import { readScanResults } from '../security/pass.mjs'

const PRIORITY = (i) => (i.kev || i.severity === 'critical' ? 'priority:p0' : i.severity === 'high' ? 'priority:p1' : 'priority:p2')
const ORDER = ['priority:p0', 'priority:p1', 'priority:p2', 'priority:p3']
const COPYLEFT = /\b(A?GPL|SSPL|EUPL|OSL|CC-BY-SA)\b/i

/** Proposals for the packages with advisories: one per package, its priority from the worst advisory. */
export function dependencyProposals(cache) {
  const byPackage = new Map()
  for (const i of (cache?.items ?? []).filter((x) => !x.accepted)) {
    for (const p of i.touched ?? []) {
      const k = `${p.name}@${p.version}`
      const e = byPackage.get(k) ?? { pkg: p, items: [] }
      e.items.push(i)
      byPackage.set(k, e)
    }
  }
  return [...byPackage.entries()].map(([k, { pkg, items }]) => {
    const priority = items.map(PRIORITY).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0]
    const fixed = items.map((i) => i.fixed).filter(Boolean).sort().at(-1) ?? null
    return {
      id: `dep:${pkg.name}`, kind: 'dependency', priority, labels: ['type:bug', priority, 'area:security'],
      title: `Dependencies: update ${pkg.name} ${pkg.version}${fixed ? ` to ${fixed}` : ''} (${items.length} advisor${items.length === 1 ? 'y' : 'ies'})`,
      evidence: items.map((i) => `${i.id}${i.aliases?.length ? ` (${i.aliases[0]})` : ''}: ${i.kev ? 'known exploited, ' : ''}${i.severity}${i.summary ? `: ${i.summary}` : ''}`),
      fix: fixed ? `upgrade ${pkg.name} to ${fixed} or later` : `no fixed version yet: mitigate, replace ${pkg.name}, or record the accepted risk`,
      shipped: !pkg.dev, package: k,
    }
  }).sort((a, b) => ORDER.indexOf(a.priority) - ORDER.indexOf(b.priority) || a.id.localeCompare(b.id))
}

/** Proposals for secrets: scanner findings (values never copied) and tracked .env files. */
export function secretProposals(cwd, { reports = [], tracked = [] } = {}) {
  const out = []
  const found = readScanResults(cwd, reports).filter((r) => r.file && /secret|key|token|password|credential|gitleaks/i.test(`${r.scanner} ${r.rule} ${r.problem}`))
  for (const r of found) out.push({ id: `secret:${r.file}:${r.line ?? 0}`, kind: 'secret', priority: 'priority:p0', labels: ['type:bug', 'priority:p0', 'area:security'], title: `Secrets: rotate the secret found in ${r.file}`, evidence: [`[${r.scanner}] ${r.file}${r.line ? `:${r.line}` : ''}: ${r.problem}`], fix: 'rotate it first, then remove it from the code and the history; keep it in the platform secrets' })
  for (const f of tracked.filter((x) => /(^|\/)\.env(\.[^/]+)?$/.test(x) && !/\.(example|sample|template|dist)$/.test(x))) out.push({ id: `secret:${f}`, kind: 'secret', priority: 'priority:p0', labels: ['type:bug', 'priority:p0', 'area:security'], title: `Secrets: stop tracking ${f}`, evidence: [`${f} is tracked by git`], fix: `rotate what it holds, untrack it (git rm --cached ${f}), ignore it, and commit an ${f}.example without values` })
  return out
}

/** Proposals for licenses: copyleft or missing licenses of shipped npm packages (package-lock.json). */
export function licenseProposals(cwd) {
  const f = join(cwd, 'package-lock.json')
  if (!existsSync(f)) return []
  let lock
  try { lock = JSON.parse(readFileSync(f, 'utf8')) } catch { return [] }
  const copyleft = []
  const missing = []
  for (const [path, p] of Object.entries(lock.packages ?? {})) {
    if (!path || p.dev) continue
    const name = p.name ?? path.split('node_modules/').pop()
    const lic = typeof p.license === 'string' ? p.license : null
    if (!lic) missing.push(`${name}@${p.version}`)
    else if (COPYLEFT.test(lic) && !/\bOR\b/i.test(lic)) copyleft.push(`${name}@${p.version} (${lic})`)
  }
  const out = []
  if (copyleft.length) out.push({ id: 'license:copyleft', kind: 'license', priority: 'priority:p1', labels: ['type:chore', 'priority:p1', 'area:security'], title: `Licenses: review ${copyleft.length} copyleft dependenc${copyleft.length === 1 ? 'y' : 'ies'}`, evidence: copyleft, fix: 'check each license against how the product is distributed; replace what the license does not allow' })
  if (missing.length) out.push({ id: 'license:unknown', kind: 'license', priority: 'priority:p3', labels: ['type:chore', 'priority:p3', 'area:security'], title: `Licenses: ${missing.length} shipped dependenc${missing.length === 1 ? 'y has' : 'ies have'} no declared license`, evidence: missing.slice(0, 20), fix: 'look each one up; an undeclared license is all rights reserved' })
  return out
}

/** The whole upkeep audit: prioritized proposals, read-only. */
export function upkeep(cwd, { reports = [], tracked = [] } = {}) {
  const cache = readCache(cwd)
  const proposals = [...dependencyProposals(cache), ...secretProposals(cwd, { reports, tracked }), ...licenseProposals(cwd)]
    .sort((a, b) => ORDER.indexOf(a.priority) - ORDER.indexOf(b.priority))
  return { proposals, advisoriesAt: cache?.at ?? null, notes: cache ? [] : ['no advisory watch yet: run agent-os security watch (it sends only package names and versions), then audit again'] }
}
