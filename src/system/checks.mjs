// System checks: structural problems that become integration or security bugs. They read system.yaml, the endpoint
// inventory and source files as text (nothing is run): spec drift, public routes with no visible authentication,
// internal components deployed publicly, incoming webhooks without signature verification, dependency cycles between
// components and between modules, deep imports past a package's entry point, a database shared by services that
// claim independence, and outgoing calls without a timeout. Each finding names the component, the file and the fix.

import { readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { listFiles } from '../stack/detect.mjs'
import { componentGraph, ownerOf } from './affected.mjs'
import { readSystem } from './system.mjs'
import { inventory } from './endpoints.mjs'

const read = (cwd, f) => { try { return readFileSync(join(cwd, f), 'utf8') } catch { return null } }
const CODE = /\.(m?[jt]sx?|cjs|py|go|java|kt|cs|rb)$/
const JS = /\.(m?[jt]sx?|cjs)$/
const isTest = (f) => /(^|\/)(test|tests|__tests__|__fixtures__|fixtures|spec)\//.test(f) || /\.(test|spec)\.[^/]+$/.test(f)
const SIGNED = /constructEvent|verifySignature|verifyWebhook|webhooks?\.verify|Webhook\([^)]*\)\.verify|svix|timingSafeEqual|compare_digest|createHmac|hmac\.(new|compare)|x-hub-signature|stripe-signature|x-signature|x-slack-signature|ValidateSignature|verify_webhook/i
const PUBLIC_FILES = ['vercel.json', 'netlify.toml', 'wrangler.toml', 'wrangler.json', 'fly.toml']
const OPEN_PATHS = /^\/?(health|healthz|ready|readyz|live|livez|ping|status|metrics|favicon\.ico|robots\.txt|sitemap\.xml|\.well-known\/.*)?$/i

const finding = (level, check, component, file, message, fix) => ({ level, check, component: component ?? null, file: file ?? null, message, fix })

/** Cycles in a directed graph (adjacency map), each once, starting from its smallest node. */
export function cycles(graph) {
  const out = []
  const seen = new Set()
  const stack = []
  const onStack = new Set()
  const visit = (n) => {
    stack.push(n); onStack.add(n)
    for (const m of graph.get(n) ?? []) {
      if (onStack.has(m)) {
        const c = stack.slice(stack.indexOf(m))
        const start = c.indexOf([...c].sort()[0])
        const key = [...c.slice(start), ...c.slice(0, start)].join(' → ')
        if (!out.includes(key)) out.push(key)
      } else if (!seen.has(m)) visit(m)
    }
    stack.pop(); onStack.delete(n); seen.add(n)
  }
  for (const n of [...graph.keys()].sort()) if (!seen.has(n)) visit(n)
  return out
}

/** Relative imports of a JS/TS file, resolved to repository paths (extension-less candidates). */
function relativeImports(file, src, { dynamic = true } = {}) {
  // Dynamic import() loads lazily, so it cannot form a load-time cycle; the cycle check leaves it out.
  const re = dynamic ? /(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\(\s*|export\s[^'"]*?from\s*)['"](\.{1,2}\/[^'"]+)['"]/g : /(?:^|\n)\s*(?:import\s[^'"]*?from\s*|import\s*|export\s[^'"]*?from\s*)['"](\.{1,2}\/[^'"]+)['"]|require\(\s*['"](\.{1,2}\/[^'"]+)['"]/g
  return [...src.matchAll(re)].map((m) => normalize(join(dirname(file), m[1] ?? m[2])).split('\\').join('/'))
}
const resolveModule = (target, files) => [target, ...['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '/index.ts', '/index.js', '/index.mjs'].map((e) => `${target}${e}`)].find((c) => files.has(c)) ?? null

/** Every system finding for the repository. */
export function systemChecks(cwd, { files = listFiles(cwd) } = {}) {
  const out = []
  const system = readSystem(cwd)
  const comps = system?.components ?? {}
  const graph = componentGraph(cwd)
  const inv = inventory(cwd, { files })
  const fileSet = new Set(files)
  const code = files.filter((f) => CODE.test(f) && !isTest(f))

  // Spec drift: routes no spec documents (in a component that has a spec) and spec operations no code declares.
  const specOwners = new Set(Object.entries(comps).filter(([, c]) => (c?.provides ?? []).some((p) => Object.values(p ?? {})[0]?.spec)).map(([id]) => id))
  for (const e of inv.endpoints.filter((x) => !x.documented && (specOwners.has(x.component) || (!specOwners.size && inv.specs.length)))) {
    out.push(finding('warn', 'spec-drift', e.component, `${e.file}:${e.line}`, `${e.method} ${e.path} is not in the spec (${inv.specs.join(', ')})`, 'document it in the OpenAPI spec, or remove the route'))
  }
  for (const o of inv.specOnly) out.push(finding('warn', 'spec-drift', null, o.spec, `${o.method} ${o.path} is in ${o.spec} but no code declares it`, 'remove it from the spec, or implement it (agent-os system endpoints lists the routes found)'))

  // Public components: routes with no visible authentication marker (health and well-known paths excepted).
  for (const e of inv.endpoints) {
    const c = comps[e.component]
    if (c?.exposure !== 'public' || e.auth === 'marked' || OPEN_PATHS.test(e.path) || /webhook|hook/i.test(e.path)) continue
    out.push(finding('warn', 'public-auth', e.component, `${e.file}:${e.line}`, `${e.method} ${e.path} on the public component ${e.component} shows no authentication`, 'add the auth middleware or guard, or mark it public on purpose in a comment the reviewer can see'))
  }

  // Internal or private components with a platform file that deploys them publicly.
  for (const [id, c] of Object.entries(comps)) {
    if (!['internal', 'private'].includes(c?.exposure) || !c.path) continue
    for (const f of PUBLIC_FILES) {
      const p = c.path === '.' ? f : `${c.path}/${f}`
      if (fileSet.has(p)) out.push(finding('fail', 'exposure', id, p, `${id} is ${c.exposure} in system.yaml, but ${p} deploys it to a public host`, `remove ${f} or put the component behind the gateway; or set exposure: public if that is intended`))
    }
  }

  // Incoming webhooks: a route named like a webhook whose file shows no signature verification.
  for (const e of inv.endpoints.filter((x) => /webhook|\/hooks?\//i.test(x.path) && ['POST', 'ANY', 'PUT'].includes(x.method))) {
    const src = read(cwd, e.file) ?? ''
    if (!SIGNED.test(src)) out.push(finding('fail', 'webhook-signature', e.component, `${e.file}:${e.line}`, `${e.method} ${e.path} accepts webhooks without verifying their signature`, 'verify the provider signature before reading the payload (e.g. stripe.webhooks.constructEvent, svix, an HMAC compared with timingSafeEqual)'))
  }
  for (const [id, c] of Object.entries(comps)) for (const p of c?.provides ?? []) if (p?.webhook && p.webhook.signed === false) out.push(finding('fail', 'webhook-signature', id, 'system.yaml', `${id} receives the webhook ${p.webhook.path ?? ''} unsigned (signed: false)`, 'verify the signature and set signed: true'))

  // Cycles between components (consumes) and between modules (relative imports, JS/TS).
  const cg = new Map(Object.entries(graph.components).map(([id, c]) => [id, c.consumes.filter((x) => graph.components[x])]))
  for (const c of cycles(cg)) out.push(finding('fail', 'cycles', c.split(' → ')[0], graph.source === 'system.yaml' ? 'system.yaml' : 'package.json', `components depend on each other in a cycle: ${c} → ${c.split(' → ')[0]}`, 'break the cycle: move the shared part into its own package that both depend on'))
  const mg = new Map()
  const staticGraph = new Map()
  for (const f of code.filter((x) => JS.test(x))) {
    const src = read(cwd, f)
    if (!src) continue
    mg.set(f, relativeImports(f, src).map((t) => resolveModule(t, fileSet)).filter(Boolean))
    staticGraph.set(f, relativeImports(f, src, { dynamic: false }).map((t) => resolveModule(t, fileSet)).filter(Boolean))
  }
  for (const c of cycles(staticGraph).slice(0, 20)) out.push(finding('warn', 'cycles', ownerOf(c.split(' → ')[0], graph.components), c.split(' → ')[0], `modules import each other in a cycle: ${c}`, 'extract what both need into a third module'))

  // Deep imports: a module reaching into another component's files instead of its entry point.
  for (const [f, targets] of mg) {
    const from = ownerOf(f, graph.components)
    for (const t of targets) {
      const to = ownerOf(t, graph.components)
      if (to && from && to !== from && graph.components[to].path !== '.') out.push(finding('warn', 'deep-imports', from, f, `${f} imports ${t} from ${to} by relative path, past its entry point`, `import it from the ${to} package instead`))
    }
    const src = read(cwd, f) ?? ''
    for (const m of src.matchAll(/from\s*['"]((?:@[\w.-]+\/)?[\w.-]+)\/(src|lib|dist|internal)\/[^'"]+['"]/g)) {
      const pkg = Object.entries(graph.components).find(([id]) => m[1].endsWith(`/${id}`) || m[1] === id)
      if (pkg && pkg[0] !== from) out.push(finding('warn', 'deep-imports', from, f, `${f} imports ${m[1]}/${m[2]}/… instead of ${m[1]}`, `export what it needs from ${m[1]}'s entry point and import ${m[1]}`))
    }
  }

  // A database shared by services that do not depend on each other.
  for (const [db, c] of Object.entries(comps).filter(([, x]) => (x?.provides ?? []).some((p) => p?.db))) {
    const users = Object.entries(comps).filter(([id, x]) => id !== db && ['service', 'worker'].includes(x?.kind) && (x.consumes ?? []).includes(db)).map(([id]) => id)
    const independent = users.filter((a) => users.some((b) => a !== b && !(comps[a].consumes ?? []).includes(b) && !(comps[b].consumes ?? []).includes(a)))
    if (independent.length > 1) out.push(finding('warn', 'shared-db', db, 'system.yaml', `${independent.join(', ')} share the database ${db} without depending on each other`, `give each service its own schema or database, or route access through one of them${c?.note ? '' : ''}`))
  }

  // Outgoing calls without a timeout (services and workers, JS/TS and Python).
  for (const f of code.filter((x) => ['service', 'worker'].includes(comps[ownerOf(x, graph.components)]?.kind ?? (/^(apps\/api|services|workers)\//.test(x) ? 'service' : '')))) {
    const src = read(cwd, f) ?? ''
    const calls = [...src.matchAll(/\b(fetch|axios(?:\.\w+)?|got|ky|requests\.(?:get|post|put|patch|delete)|httpx\.(?:get|post|put|patch|delete))\s*\(([^;]*?)\)\s*[;\n]/g)].filter((m) => !/\b(timeout|signal|AbortSignal)\b/.test(m[2]))
    if (calls.length) out.push(finding('warn', 'timeouts', ownerOf(f, graph.components), `${f}:${src.slice(0, calls[0].index).split('\n').length}`, `${calls.length} outgoing call(s) without a timeout (${calls[0][1]})`, 'pass a timeout (AbortSignal.timeout(ms), { timeout }) so a slow dependency cannot hang the request'))
  }
  return out
}
