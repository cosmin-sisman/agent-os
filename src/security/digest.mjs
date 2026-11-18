// The Security digest: the advisories that touch the project, in priority order (known exploited first, then
// severity, shipped direct dependencies before the rest), as one issue kept up to date, and as a cache the release
// gate and SessionStart read without going to the network. Accepted risks (security.acceptedRisks) are listed apart.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const CACHE = '.agent-os/cache/security.json'
export const TITLE = 'Security digest'
export const MARKER = '<!-- agent-os:security-digest -->'
const RANK = { critical: 0, high: 1, moderate: 2, low: 3, unknown: 4 }

/** Each advisory with what it touches, ranked: KEV, severity, shipped direct dependency, then id. */
export function prioritize(vulns, packages, { accepted = [] } = {}) {
  const pkg = new Map(packages.map((p) => [`${p.ecosystem}|${p.name}|${p.version}`, p]))
  const acceptedIds = new Set(accepted.map((a) => a.id))
  return vulns.map((v) => {
    const touched = v.packages.map((p) => pkg.get(`${p.ecosystem}|${p.name}|${p.version}`) ?? { ...p, direct: false, dev: false })
    const shipped = touched.some((p) => !p.dev)
    const direct = touched.some((p) => p.direct && !p.dev)
    return { ...v, touched, shipped, direct, accepted: [v.id, ...v.aliases].some((a) => acceptedIds.has(a)) }
  }).sort((a, b) => Number(b.kev) - Number(a.kev) || RANK[a.severity] - RANK[b.severity] || Number(b.direct) - Number(a.direct) || Number(b.shipped) - Number(a.shipped) || a.id.localeCompare(b.id))
}

/** The issue body, in the issues language. */
export function digestBody(items, { at, packages, lang = 'en' }) {
  const ro = lang === 'ro'
  const open = items.filter((i) => !i.accepted)
  const line = (i) => `- ${i.kev ? (ro ? '**EXPLOATAT ACTIV (KEV)** ' : '**KNOWN EXPLOITED (KEV)** ') : ''}**${i.id}**${i.aliases.length ? ` (${i.aliases.slice(0, 3).join(', ')})` : ''}, ${i.severity}: ${i.touched.map((p) => `${p.name}@${p.version}${p.direct ? (ro ? ' direct' : ' direct') : ''}${p.dev ? ' dev' : ''}`).join(', ')}${i.fixed ? ` → ${ro ? 'reparat in' : 'fixed in'} ${i.fixed}` : ''}${i.summary ? `. ${i.summary}` : ''}`
  return [
    MARKER,
    ro ? `Actualizat ${at} din ${packages} pachete (lockfile-uri). Prioritate: exploatate activ, apoi severitate, apoi dependintele directe livrate.` : `Updated ${at} from ${packages} packages (lockfiles). Priority: known exploited first, then severity, then shipped direct dependencies.`,
    '',
    ...(open.length ? open.map(line) : [ro ? 'Nimic deschis.' : 'Nothing open.']),
    ...(items.some((i) => i.accepted) ? ['', ro ? '### Riscuri acceptate' : '### Accepted risks', ...items.filter((i) => i.accepted).map(line)] : []),
    '',
    ro ? 'Doar numele si versiunile pachetelor au parasit proiectul. Rezolvarea: actualizeaza pachetul; un risc acceptat se scrie in security.acceptedRisks cu motivul.' : 'Only package names and versions left the project. To resolve: update the package; an accepted risk goes into security.acceptedRisks with its reason.',
  ].join('\n')
}

/** Saves the ranked result for the release gate and SessionStart. */
export function saveCache(cwd, result) {
  const file = join(cwd, CACHE)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`)
}
export const readCache = (cwd) => { try { return existsSync(join(cwd, CACHE)) ? JSON.parse(readFileSync(join(cwd, CACHE), 'utf8')) : null } catch { return null } }

/** What the release gate refuses: known-exploited advisories in a shipped dependency that nobody accepted. */
export function releaseBlockers(cwd) {
  const c = readCache(cwd)
  return (c?.items ?? []).filter((i) => i.kev && i.shipped && !i.accepted)
}

/** One SessionStart line when the last watch found known-exploited or critical items, else null. */
export function sessionWarning(cwd) {
  const c = readCache(cwd)
  const bad = (c?.items ?? []).filter((i) => !i.accepted && (i.kev || i.severity === 'critical'))
  if (!bad.length) return null
  return `Security: ${bad.length} known-exploited or critical advisor${bad.length === 1 ? 'y' : 'ies'} in the dependencies (${bad.slice(0, 3).map((i) => `${i.id} in ${i.touched[0]?.name}`).join(', ')}${bad.length > 3 ? ', …' : ''}); see the Security digest.`
}
