// Preparing for attacks (design §23, "Preparing"). The STRIDE threat model per layer, generated from stack.yaml and
// the data flows between its layer groups, is kept as a living artifact with stack.yaml as a source, so it goes
// stale when the stack changes and is refreshed. Abuse cases ("Given an attacker…") are written for the
// security-sensitive areas a ticket touches, and tabletop exercises are walked against the project's runbooks.
// Everything here is text: scenarios target only environments the project owns, and nothing is run or filed.

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { DIR, listArtifacts, newArtifact } from '../artifacts/artifact.mjs'
import { buildArtifact } from '../artifacts/build.mjs'
import { readStack } from '../stack/stack.mjs'
import { GROUP_OF_LAYER } from './pass.mjs'

export const STRIDE = ['spoofing', 'tampering', 'repudiation', 'information disclosure', 'denial of service', 'elevation of privilege']

/** STRIDE threats and their mitigations, per layer group. */
const THREATS = {
  frontend: [
    ['spoofing', 'a phishing copy of the site or a stolen session cookie', 'HttpOnly, Secure, SameSite cookies; HSTS'],
    ['tampering', 'script injection through rendered user content (XSS)', 'escape by default; a Content-Security-Policy'],
    ['information disclosure', 'secrets or internal URLs shipped in the bundle', 'only public values in client env; a bundle scan'],
  ],
  api: [
    ['spoofing', 'calls with a forged or replayed token, unsigned webhooks', 'verify every token and webhook signature'],
    ['tampering', 'mass assignment or a changed id in the request (IDOR)', 'validate input with a schema; check ownership per object'],
    ['repudiation', 'a sensitive action with no record of who did it', 'an audit log of who, what and when'],
    ['denial of service', 'unbounded requests, pages or uploads', 'rate limits, page size limits, timeouts'],
    ['elevation of privilege', 'an endpoint that skips the authorization check', 'deny by default; a test per role'],
  ],
  auth: [
    ['spoofing', 'credential stuffing and password spraying', 'rate limits, lockout, MFA'],
    ['elevation of privilege', 'a role or tenant changed through the session or a token claim', 'roles from the server, never from the client'],
    ['information disclosure', 'account enumeration through login or reset messages', 'the same answer for known and unknown accounts'],
  ],
  data: [
    ['tampering', 'SQL injection through built queries', 'parameterized queries only'],
    ['information disclosure', 'a backup, a replica or a log with personal data left open', 'encryption at rest; least-privilege access; no PII in logs'],
    ['denial of service', 'a slow query or a lock that takes the database down', 'statement timeouts, indexes, connection limits'],
  ],
  infra: [
    ['elevation of privilege', 'a container running as root or an over-broad cloud role', 'non-root images; least-privilege roles'],
    ['information disclosure', 'a public bucket or an open security group', 'closed defaults; a review of every public resource'],
  ],
  ci: [
    ['tampering', 'a third-party action or a dependency changed upstream', 'actions pinned by SHA; a lockfile; provenance'],
    ['information disclosure', 'secrets exposed to pull requests from forks', 'least-privilege tokens; no secrets on untrusted events'],
  ],
}
/** The data flows between layer groups that cross a trust boundary. */
const FLOWS = [['frontend', 'api'], ['frontend', 'auth'], ['api', 'auth'], ['api', 'data'], ['ci', 'infra']]

const sha = (t) => createHash('sha256').update(t).digest('hex')

/** The threat model of a stack: per layer, its STRIDE threats; and the flows between the groups in use. */
export function threatModel(stack) {
  const layers = Object.keys(stack?.layers ?? {}).filter((l) => (stack.layers[l]?.status ?? 'chosen') !== 'rejected').sort()
  const rows = layers.map((layer) => ({ layer, tech: stack.layers[layer]?.tech ?? null, group: GROUP_OF_LAYER[layer] ?? null }))
  const groups = new Set(rows.map((r) => r.group).filter(Boolean))
  const threats = rows.flatMap((r) => (THREATS[r.group] ?? []).map(([category, threat, mitigation]) => ({ layer: r.layer, tech: r.tech, category, threat, mitigation })))
  const flows = FLOWS.filter(([a, b]) => groups.has(a) && groups.has(b)).map(([from, to]) => ({ from, to, crosses: 'a trust boundary: authenticate, authorize and validate at the receiving side' }))
  return { layers: rows, threats, flows, uncovered: rows.filter((r) => !r.group).map((r) => r.layer) }
}

const pageData = (model, { lang = 'en', now }) => ({
  kind: 'threat-model', lang, title: lang === 'ro' ? 'Model de amenintari' : 'Threat model', subtitle: 'STRIDE · stack.yaml', updated: now.toISOString().slice(0, 10),
  sections: [
    { heading: lang === 'ro' ? 'Straturi' : 'Layers', table: { columns: lang === 'ro' ? ['Strat', 'Tehnologie', 'Grup'] : ['Layer', 'Technology', 'Group'], rows: model.layers.map((l) => [l.layer, l.tech ?? '-', l.group ?? { text: lang === 'ro' ? 'fara model' : 'not modelled', tone: 'warn' }]) } },
    { heading: lang === 'ro' ? 'Amenintari (STRIDE)' : 'Threats (STRIDE)', table: { columns: lang === 'ro' ? ['Strat', 'Categorie', 'Amenintare', 'Masura'] : ['Layer', 'Category', 'Threat', 'Mitigation'], rows: model.threats.map((t) => [t.layer, t.category, t.threat, t.mitigation]) } },
    { heading: lang === 'ro' ? 'Fluxuri de date' : 'Data flows', items: model.flows.map((f) => `${f.from} → ${f.to}: ${f.crosses}`) },
  ],
  model,
})

/** The living threat-model artifact, if there is one. */
export function findThreatModel(root) {
  return listArtifacts(root).find((a) => a.type === 'threat-model') ?? null
}

/** Whether the threat model no longer matches stack.yaml (or anything else it was built from). */
export function threatModelStale(root) {
  const a = findThreatModel(root)
  return a ? { id: a.folder, stale: a.stale } : null
}

/**
 * Creates the threat model, or refreshes it in place when stack.yaml changed: the data is regenerated, the page
 * rebuilt, and stack.yaml's new hash recorded, so the next change makes it stale again.
 */
export function refreshThreatModel(root, { lang = 'en', now = new Date(), dryRun = false, force = false } = {}) {
  const stack = readStack(root)
  if (!stack) throw new CliError('there is no stack.yaml to model', { hint: 'agent-os stack init, or agent-os stack detect --write' })
  const model = threatModel(stack)
  const existing = findThreatModel(root)
  if (existing && !existing.stale.length && !force) return { id: existing.folder, action: 'current', model, dryRun }
  const data = pageData(model, { lang, now })
  if (dryRun) return { id: existing?.folder ?? `${now.toISOString().slice(0, 10)}-threat-model`, action: existing ? 'refresh' : 'create', model, dryRun }
  let id = existing?.folder
  if (!id) id = newArtifact(root, { type: 'threat-model', slug: 'threat-model', title: data.title, now, lang, data }).id
  else writeFileSync(join(root, DIR, id, 'data.json'), `${JSON.stringify(data, null, 2)}\n`)
  addSource(root, id, 'stack.yaml')
  buildArtifact(root, id)
  return { id, action: existing ? 'refreshed' : 'created', model, dryRun }
}

/** Records a source in artifact.yaml (path and hash); buildArtifact then keeps it and rehashes every source. */
function addSource(root, id, path) {
  const file = join(root, DIR, id, 'artifact.yaml')
  const text = readFileSync(file, 'utf8')
  if (text.includes(`- path: ${path}\n`)) return
  const entry = `  - path: ${path}\n    sha256: "${sha(readFileSync(join(root, path)))}"\n`
  writeFileSync(file, /^sources:\s*\[\]\s*$/m.test(text) ? text.replace(/^sources:\s*\[\]\s*$/m, `sources:\n${entry.trimEnd()}`) : text.replace(/^sources:\n/m, `sources:\n${entry}`))
}

/** The security-sensitive areas a ticket touches, from its labels and words. */
const SENSITIVE = {
  payments: /\b(payments?|checkout|billing|invoices?|refunds?|stripe|card|subscriptions?|plata|plati|facturi?)\b/i,
  auth: /\b(auth|authentication|authorization|login|sign[ -]?in|sign[ -]?up|passwords?|sso|oauth|mfa|2fa|access control|autentificare|parola)\b/i,
  'public-api': /\b(public api|webhooks?|endpoints?|api keys?|rate limit)\b/i,
  'personal-data': /\b(personal data|pii|gdpr|e-?mail address(es)?|phone numbers?|addresses|date personale)\b/i,
}
const ABUSE = {
  en: {
    payments: ['Given an attacker, when they replay or change the amount of a payment request, then the server rejects it and charges nothing', 'Given an attacker, when they send a forged payment webhook, then its signature check fails and no order is marked paid'],
    auth: ['Given an attacker, when they try many passwords for one account, then they are rate limited and the owner can see it', "Given an attacker with a valid session, when they call an action of another role or tenant, then it is denied"],
    'public-api': ['Given an attacker, when they change an id in the request to another customer\'s, then the API answers 404 or 403 and leaks nothing', 'Given an attacker, when they flood the endpoint, then they are rate limited and other clients still get answers'],
    'personal-data': ["Given an attacker, when they request another user's personal data, then it is denied and the attempt is logged without the data", 'Given an attacker, when an error happens, then no personal data appears in the response or the logs'],
  },
  ro: {
    payments: ['Dat fiind un atacator, cand retrimite sau schimba suma unei cereri de plata, atunci serverul o respinge si nu incaseaza nimic', 'Dat fiind un atacator, cand trimite un webhook de plata fals, atunci verificarea semnaturii pica si nicio comanda nu e marcata platita'],
    auth: ['Dat fiind un atacator, cand incearca multe parole pentru un cont, atunci e limitat si proprietarul vede asta', 'Dat fiind un atacator cu o sesiune valida, cand apeleaza o actiune a altui rol sau client, atunci e refuzat'],
    'public-api': ['Dat fiind un atacator, cand schimba un id din cerere cu al altui client, atunci API-ul raspunde 404 sau 403 si nu divulga nimic', 'Dat fiind un atacator, cand inunda endpoint-ul, atunci e limitat si ceilalti clienti primesc raspuns'],
    'personal-data': ['Dat fiind un atacator, cand cere datele personale ale altui utilizator, atunci e refuzat si incercarea e logata fara date', 'Dat fiind un atacator, cand apare o eroare, atunci nicio data personala nu apare in raspuns sau in loguri'],
  },
}

/**
 * The sensitive areas of an issue: its area labels (area:payments, area:auth…), then the words of its title and of its
 * Goal or Context. The rest of the body is left out: words in acceptance criteria are too often about something else.
 */
export function sensitiveAreas(issue) {
  const labels = (issue.labels ?? []).map((l) => String(typeof l === 'string' ? l : l?.name ?? '').toLowerCase())
  const head = String(issue.body ?? '').match(/^#{2,3}\s+(Goal|Context|Scop|Context)\s*$([\s\S]*?)(?=^#{1,3}\s|$(?![\s\S]))/gim) ?? []
  const text = `${issue.title ?? ''}\n${head.join('\n')}`
  return Object.keys(SENSITIVE).filter((a) => labels.some((l) => l === `area:${a}` || l.endsWith(`:${a}`)) || SENSITIVE[a].test(text))
}

/** "Given an attacker…" scenarios for the sensitive areas an issue touches. */
export function abuseCases(issue, { lang = 'en' } = {}) {
  const words = ABUSE[lang] ?? ABUSE.en
  return sensitiveAreas(issue).flatMap((a) => words[a])
}

/** Tabletop exercises: what happens, the steps a runbook should cover, and the words that show it does. */
export const EXERCISES = {
  'leaked-key': { title: 'A secret key leaked (in a commit, a log or a screenshot)', steps: [['revoke', /revok|rotat/i], ['find where it was used', /audit log|access log|usage/i], ['rotate every copy', /rotat/i], ['tell who must know', /notif|inform|contact/i]] },
  'compromised-account': { title: 'A team or customer account was taken over', steps: [['lock the account and end its sessions', /lock|disable|suspend|session/i], ['reset credentials and MFA', /reset|mfa|2fa/i], ['review what it did', /audit log|review/i], ['tell the owner', /notif|inform|contact/i]] },
  'vulnerable-dependency': { title: 'A dependency in production has a known-exploited vulnerability', steps: [['find where it runs', /sbom|inventory|depend/i], ['patch or mitigate', /patch|upgrade|update|mitigat/i], ['deploy the fix', /deploy|release|rollout/i], ['check for exploitation', /log|indicator|exploit/i]] },
}

const RUNBOOK_DIRS = ['docs/runbooks', 'runbooks', 'docs/operations', 'docs/incidents']

/** The runbooks of a project: Markdown files in the usual folders, and RUNBOOK*.md at the root. */
export function findRunbooks(root) {
  const out = []
  const walk = (dir) => { for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) walk(p); else if (/\.md$/i.test(e)) out.push(p) } }
  for (const d of RUNBOOK_DIRS) if (existsSync(join(root, d))) walk(join(root, d))
  for (const e of readdirSync(root)) if (/^runbook.*\.md$/i.test(e)) out.push(join(root, e))
  return out.map((p) => relative(root, p).split('\\').join('/')).sort()
}

/** Walks one exercise against the runbooks: each step is covered (by which runbook) or a gap, proposed as an issue. */
export function exercise(root, name) {
  const ex = EXERCISES[name]
  if (!ex) throw new CliError(`unknown exercise "${name}"`, { hint: Object.keys(EXERCISES).join(', ') })
  const books = findRunbooks(root).map((p) => ({ path: p, text: readFileSync(join(root, p), 'utf8') }))
  const steps = ex.steps.map(([step, re]) => { const b = books.find((x) => re.test(x.text)); return { step, covered: Boolean(b), runbook: b?.path ?? null } })
  const gaps = steps.filter((s) => !s.covered)
  return {
    name, title: ex.title, runbooks: books.map((b) => b.path), steps,
    proposed: gaps.length ? { title: `Runbooks: cover "${ex.title.toLowerCase()}"`, labels: ['type:docs', 'area:security'], steps: gaps.map((g) => g.step) } : null,
    note: 'a tabletop exercise: walk it with the team, against environments the project owns only; the proposed issue is filed only on confirmation (/ticket)',
  }
}
