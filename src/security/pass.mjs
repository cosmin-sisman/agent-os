// The security pass on a change request (design §23.2): the OWASP ASVS checklist items of the layers the diff
// touches, the problems the changed files show in their text (each with the checklist item, the fix and the reason),
// and the results of the scanners the project runs, read from their report files (SARIF, gitleaks JSON). agent-os
// never installs or runs a scanner; a scanner the team expects but the laptop lacks is reported by /env.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { areaLayers, layersOf } from '../stack/areas.mjs'
import { inventory } from '../system/endpoints.mjs'
import { reviewText, kindOf } from '../ci/review.mjs'

/** Checklist items by layer group (OWASP ASVS 4.0.3 references). */
export const CHECKLISTS = {
  auth: [
    { id: 'V2.1.1', text: 'passwords are at least 12 characters and checked against breached lists' },
    { id: 'V3.4.1', text: 'session cookies are Secure, HttpOnly and SameSite' },
    { id: 'V3.5.3', text: 'tokens are verified (signature, algorithm, expiry, audience) before use' },
    { id: 'V4.1.1', text: 'authorization is enforced on the server for every path and object' },
  ],
  api: [
    { id: 'V4.1.3', text: 'every endpoint checks the caller may act on that resource (no IDOR)' },
    { id: 'V5.1.3', text: 'every input is validated with an allowlist schema' },
    { id: 'V11.1.4', text: 'public endpoints are rate limited (anti-automation)' },
    { id: 'V13.2.1', text: 'incoming webhooks verify their signature before reading the payload' },
  ],
  data: [
    { id: 'V5.3.4', text: 'queries are parameterized; no string-built SQL' },
    { id: 'V4.2.1', text: 'row-level security or ownership filters protect every table reachable from outside' },
    { id: 'V8.3.4', text: 'migrations do not expose personal data (new views, grants, public tables)' },
  ],
  frontend: [
    { id: 'V5.3.3', text: 'output is encoded for its context; no raw HTML from data (XSS)' },
    { id: 'V14.4.3', text: 'a Content-Security-Policy is set' },
    { id: 'V14.1.1', text: 'no secrets in the client bundle (public env variables are public)' },
  ],
  ci: [
    { id: 'V14.1.5', text: 'CI cannot run untrusted input as code; tokens have least privilege; actions are pinned' },
  ],
  infra: [
    { id: 'V14.1.2', text: 'images are pinned and run as a non-root user; only needed ports are exposed' },
    { id: 'V14.1.3', text: 'infrastructure defaults are closed (no 0.0.0.0/0, no public buckets)' },
  ],
}
export const GROUP_OF_LAYER = {
  auth: 'auth', 'internal-api': 'api', 'public-api-webhooks': 'api', 'backend-services': 'api', 'integration-service': 'api', realtime: 'api',
  'data-layer': 'data', storage: 'data', 'cache-queue': 'data',
  'public-frontend': 'frontend', 'internal-frontend': 'frontend', mobile: 'frontend', cms: 'frontend',
  'ci-cd': 'ci', infrastructure: 'infra',
}
/** Layer groups from a file's path when the stack does not say (a project without stack.yaml still gets a pass). */
function groupsByPath(f) {
  const out = new Set()
  if (/(^|\/)\.github\/workflows\/|\.gitlab-ci\.yml$|(^|\/)\.gitlab\//.test(f)) out.add('ci')
  if (/(^|\/)(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$|\.tf$|(^|\/)(k8s|helm|charts)\//.test(f)) out.add('infra')
  if (/\.sql$|(^|\/)migrations?\//.test(f)) out.add('data')
  if (/(^|\/)(auth|login|session)s?[/.]/i.test(f)) out.add('auth')
  if (/(^|\/)(api|routes?|controllers?|handlers?|server)[/.]/i.test(f)) out.add('api')
  if (/\.(tsx|jsx|vue|svelte|astro|html)$/.test(f)) out.add('frontend')
  return out
}

const item = (group, id) => CHECKLISTS[group].find((i) => i.id === id)
const finding = (level, group, id, file, line, problem, fix, why) => ({ level, layer: group, item: `${id} ${item(group, id)?.text ?? ''}`.trim(), file, line, problem, fix, why })
const RATE = /rateLimit|rate-limit|ratelimit|throttle|slowapi|limiter|RateLimiter|@Throttle/i
const SIGNED = /constructEvent|verifySignature|verifyWebhook|webhooks?\.verify|svix|timingSafeEqual|compare_digest|createHmac|stripe-signature|x-hub-signature/i

/** Text detections on the changed files of one group. */
function detect(cwd, files, groups) {
  const out = []
  const read = (f) => { try { return readFileSync(join(cwd, f), 'utf8') } catch { return '' } }
  const lineOf = (src, i) => src.slice(0, i).split('\n').length
  if (groups.has('api')) {
    const routes = inventory(cwd).endpoints.filter((e) => files.includes(e.file))
    for (const r of routes) {
      const src = read(r.file)
      if (/webhook|\/hooks?\//i.test(r.path)) { if (!SIGNED.test(src)) out.push(finding('error', 'api', 'V13.2.1', r.file, r.line, `${r.method} ${r.path} accepts webhooks without verifying their signature`, 'verify the provider signature on the raw body before parsing it (stripe.webhooks.constructEvent, svix, an HMAC compared with timingSafeEqual)', 'anyone who learns the URL can forge events')); continue }
      if (r.method !== 'GET' && !RATE.test(src)) out.push(finding('warn', 'api', 'V11.1.4', r.file, r.line, `${r.method} ${r.path} is a new endpoint with no rate limiting in its file`, 'add a rate limiter on the route or at the gateway (per IP and per account) and test the limit', 'an endpoint without limits can be brute-forced or used to exhaust resources'))
      else if (!RATE.test(src) && r.auth !== 'marked') out.push(finding('warn', 'api', 'V11.1.4', r.file, r.line, `${r.method} ${r.path} is a new public endpoint with no rate limiting or authentication in its file`, 'add a rate limiter, or authentication if it should not be public', 'unauthenticated endpoints without limits invite scraping and abuse'))
    }
  }
  for (const f of files) {
    const src = read(f)
    if (!src) continue
    const hits = (re) => [...src.matchAll(re)].map((m) => lineOf(src, m.index))
    if (groups.has('data') || /\.(m?[jt]sx?|py|go|java|kt|cs|rb|php)$/.test(f)) {
      for (const l of hits(/\b(query|execute|raw|exec|sql)\s*\(\s*`[^`]*\$\{|\b(query|execute|cursor\.execute)\s*\(\s*["'][^"']*["']\s*(\+|%)\s*\w|f["']\s*(SELECT|INSERT|UPDATE|DELETE)\b[^"']*\{/gi)) out.push(finding('error', 'data', 'V5.3.4', f, l, 'SQL is built from a string with values in it', 'use bound parameters ($1, ?, :name) or the query builder', 'string-built SQL is injectable'))
    }
    if (/\.(tsx|jsx|vue|svelte|astro|html|m?[jt]s)$/.test(f)) {
      for (const l of hits(/dangerouslySetInnerHTML|\.innerHTML\s*=|v-html=|\{@html\s|set:html=/g)) out.push(finding('warn', 'frontend', 'V5.3.3', f, l, 'raw HTML is inserted into the page', 'render text, or sanitize with a vetted library (DOMPurify) when HTML is really needed', 'HTML from data runs as script (XSS)'))
      for (const l of hits(/\b(NEXT_PUBLIC|VITE|PUBLIC|EXPO_PUBLIC|REACT_APP)_[A-Z0-9_]*(SECRET|PRIVATE|SERVICE_ROLE|PASSWORD|TOKEN)[A-Z0-9_]*/g)) out.push(finding('error', 'frontend', 'V14.1.1', f, l, 'a secret-looking variable is exposed to the client bundle', 'keep it on the server; only publishable keys may be public', 'everything in a public variable ships to every browser'))
    }
    if (/(^|\/)(auth|login|session)/i.test(f) || groups.has('auth')) {
      for (const l of hits(/algorithms?\s*:\s*\[?\s*['"]none['"]|verify\s*:\s*false|ignoreExpiration\s*:\s*true|verify_signature['"]?\s*:\s*False/g)) out.push(finding('error', 'auth', 'V3.5.3', f, l, 'a token is accepted without full verification', 'verify the signature with a fixed algorithm, and check expiry and audience', 'unverified tokens let anyone impersonate a user'))
      for (const l of hits(/(httpOnly|secure)\s*:\s*false/gi)) out.push(finding('warn', 'auth', 'V3.4.1', f, l, 'a cookie is set without HttpOnly or Secure', 'set httpOnly: true, secure: true and sameSite', 'scripts or plain HTTP could read the session'))
    }
    if (/(^|\/)(Dockerfile)$/.test(f)) {
      // A base image with no tag, or :latest, and no digest is not pinned (scratch and build stages are fine).
      for (const m of src.matchAll(/^FROM\s+(?:--platform=\S+\s+)?(\S+)/gm)) {
        const image = m[1]
        if (image === 'scratch' || image.includes('@sha256:') || /^\$/.test(image)) continue
        const tag = image.split('/').pop().split(':')[1]
        if (!tag || tag === 'latest') out.push(finding('warn', 'infra', 'V14.1.2', f, lineOf(src, m.index), `the base image ${image} is not pinned`, 'pin a version (and a digest)', 'an unpinned base changes under you'))
      }
      if (!/^USER\s+(?!root\b)\S+/m.test(src)) out.push(finding('warn', 'infra', 'V14.1.2', f, 1, 'the image runs as root', 'add a non-root USER', 'a compromised process gets root in the container'))
    }
    if (/\.tf$/.test(f)) for (const l of hits(/0\.0\.0\.0\/0/g)) out.push(finding('warn', 'infra', 'V14.1.3', f, l, 'a rule opens to 0.0.0.0/0', 'restrict the source range', 'the resource is reachable from the whole internet'))
    if (kindOf(f)) for (const r of reviewText(src, f).filter((x) => x.level === 'error')) out.push(finding('error', 'ci', 'V14.1.5', f, null, r.message, 'see agent-os ci review', `CI rule ${r.rule}`))
  }
  return out
}

/** Scanner results from report files: SARIF (CodeQL, Semgrep, GitLab SAST, Trivy…) and gitleaks JSON. Secrets are never copied. */
export function readScanResults(cwd, paths) {
  const out = []
  for (const p of paths) {
    const file = join(cwd, p)
    if (!existsSync(file)) { out.push({ level: 'warn', scanner: p, problem: `the scanner report ${p} does not exist` }); continue }
    let doc
    try { doc = JSON.parse(readFileSync(file, 'utf8')) } catch { out.push({ level: 'warn', scanner: p, problem: `${p} is not JSON` }); continue }
    if (Array.isArray(doc?.runs)) {
      for (const run of doc.runs) for (const r of run.results ?? []) {
        const loc = r.locations?.[0]?.physicalLocation
        out.push({ level: r.level === 'error' ? 'error' : 'warn', scanner: run.tool?.driver?.name ?? 'SARIF', rule: r.ruleId ?? null, file: loc?.artifactLocation?.uri?.replace(/^file:\/\//, '') ?? null, line: loc?.region?.startLine ?? null, problem: r.message?.text ?? r.ruleId ?? 'finding' })
      }
    } else if (Array.isArray(doc) && doc.every((x) => 'RuleID' in x)) {
      for (const g of doc) out.push({ level: 'error', scanner: 'gitleaks', rule: g.RuleID, file: g.File, line: g.StartLine ?? null, problem: `possible secret (${g.Description ?? g.RuleID}); value not shown` })
    } else out.push({ level: 'warn', scanner: p, problem: `${p} is neither SARIF nor a gitleaks report` })
  }
  return out
}

/**
 * The pass for a set of changed files: the layer groups touched, their checklists, the findings (with the
 * checklist item, the fix and the reason) and the scanner results on those files.
 */
export function securityPass(cwd, files, { scanResults = [] } = {}) {
  const layers = areaLayers(cwd)
  const groups = new Set()
  for (const f of files) {
    for (const l of layersOf(f, layers)) if (GROUP_OF_LAYER[l]) groups.add(GROUP_OF_LAYER[l])
    for (const g of groupsByPath(f)) groups.add(g)
  }
  const findings = detect(cwd, files, groups)
  for (const f of findings) groups.add(f.layer)
  const scans = readScanResults(cwd, scanResults).filter((s) => !s.file || files.includes(s.file))
  return { groups: [...groups].sort(), checklists: Object.fromEntries([...groups].sort().map((g) => [g, CHECKLISTS[g]])), findings, scans }
}
