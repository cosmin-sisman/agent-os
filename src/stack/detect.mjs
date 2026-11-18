// Detecting the stack from the code: manifests (package.json, Python requirements), lockfiles, framework configs,
// Dockerfiles, migrations and workflows point to catalog technologies, each with the file that shows it. `drift`
// compares those findings with stack.yaml, so the file never lies about the code. Nothing is run; files are read.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse } from '../yaml/yaml.mjs'
import { matches } from '../util/glob.mjs'
import { loadCatalog } from './catalog.mjs'

/**
 * Each rule names a catalog technology and what shows it: npm packages (a trailing / matches a scope), Python
 * packages, or files (globs). `all` means every listed package must be there.
 */
export const RULES = [
  { tech: 'astro', npm: ['astro'], files: ['astro.config.*'] },
  { tech: 'next-js', npm: ['next'], files: ['next.config.*'] },
  { tech: 'sveltekit', npm: ['@sveltejs/kit'], files: ['svelte.config.*'] },
  { tech: 'nuxt', npm: ['nuxt'], files: ['nuxt.config.*'] },
  { tech: 'hugo', files: ['hugo.toml', 'hugo.yaml'] },
  { tech: 'vite-react-tanstack-router', npm: ['@tanstack/react-router'] },
  { tech: 'vue-vite', npm: ['vue', 'vite'], all: true },
  { tech: 'angular', npm: ['@angular/core'], files: ['angular.json'] },
  { tech: 'refine-react-admin', npm: ['@refinedev/core'] },
  { tech: 'django-admin', py: ['django'] },
  { tech: 'expo-react-native', npm: ['expo'] },
  { tech: 'flutter', files: ['pubspec.yaml'] },
  { tech: 'capacitor', npm: ['@capacitor/core'], files: ['capacitor.config.*'] },
  { tech: 'electron', npm: ['electron'] },
  { tech: 'tauri', npm: ['@tauri-apps/api'], files: ['tauri.conf.json'] },
  { tech: 'hono-trpc', npm: ['hono', '@trpc/server'], all: true },
  { tech: 'hono-orpc', npm: ['hono', '@orpc/server'], all: true },
  { tech: 'hono-zod-openapi', npm: ['@hono/zod-openapi'] },
  { tech: 'nestjs', npm: ['@nestjs/core'] },
  { tech: 'fastapi', py: ['fastapi'] },
  { tech: 'django-rest-framework', py: ['djangorestframework'] },
  { tech: 'laravel', files: ['artisan'] },
  { tech: 'pg-boss', npm: ['pg-boss'] },
  { tech: 'trigger-dev', npm: ['@trigger.dev/sdk'] },
  { tech: 'inngest', npm: ['inngest'] },
  { tech: 'bullmq', npm: ['bullmq'] },
  { tech: 'celery', py: ['celery'] },
  { tech: 'socket-io', npm: ['socket.io'] },
  { tech: 'claude-api-anthropic-sdk', npm: ['@anthropic-ai/sdk'], py: ['anthropic'] },
  { tech: 'vercel-ai-sdk', npm: ['ai'] },
  { tech: 'drizzle-supabase-postgres', npm: ['drizzle-orm'], files: ['drizzle.config.*'] },
  { tech: 'prisma-neon-postgres', npm: ['@prisma/client', 'prisma'], files: ['schema.prisma'] },
  { tech: 'mongodb-atlas', npm: ['mongodb', 'mongoose'] },
  { tech: 'upstash-redis', npm: ['@upstash/redis'] },
  { tech: 'redis-self-hosted', npm: ['ioredis', 'redis'] },
  { tech: 'posthog', npm: ['posthog-js', 'posthog-node'] },
  { tech: 'supabase-auth', npm: ['@supabase/ssr', '@supabase/auth-helpers-nextjs'] },
  { tech: 'clerk', npm: ['@clerk/'] },
  { tech: 'better-auth', npm: ['better-auth'] },
  { tech: 'sanity', npm: ['sanity', '@sanity/client'] },
  { tech: 'payload-cms', npm: ['payload'] },
  { tech: 'keystatic', npm: ['@keystatic/core'] },
  { tech: 'resend', npm: ['resend'] },
  { tech: 'expo-push', npm: ['expo-notifications'] },
  { tech: 'twilio-sms', npm: ['twilio'] },
  { tech: 'stripe', npm: ['stripe', '@stripe/stripe-js'], py: ['stripe'] },
  { tech: 'revenuecat', npm: ['react-native-purchases'] },
  { tech: 'github-actions', files: ['.github/workflows/*.yml', '.github/workflows/*.yaml'], root: true },
  { tech: 'gitlab-ci', files: ['.gitlab-ci.yml'] },
  { tech: 'eas-build', files: ['eas.json'] },
  { tech: 'codemagic', files: ['codemagic.yaml'] },
  { tech: 'turborepo-pnpm', files: ['turbo.json'] },
  { tech: 'docker', files: ['Dockerfile', 'docker-compose.yml', 'compose.yaml'] },
  { tech: 'terraform', files: ['*.tf'] },
  { tech: 'sentry', npm: ['@sentry/'], py: ['sentry-sdk'] },
  { tech: 'datadog', npm: ['dd-trace'] },
  { tech: 'opentelemetry', npm: ['@opentelemetry/api'] },
]

/** Files that point at a provider rather than a technology. */
const PROVIDER_FILES = [{ provider: 'vercel', files: ['vercel.json'] }, { provider: 'cloudflare', files: ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc'] }, { provider: 'fly-io', files: ['fly.toml'] }, { provider: 'railway', files: ['railway.json', 'railway.toml'] }, { provider: 'netlify', files: ['netlify.toml'] }]

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', 'coverage', 'vendor', '.venv', 'venv', '__pycache__', '.agent-os', '_site', 'target', '__fixtures__', 'fixtures'])

/** The repository's files, as relative paths, skipping dependencies and build output (bounded). */
export function listFiles(cwd, { maxDepth = 6, max = 20000 } = {}) {
  const out = []
  const walk = (d, depth) => {
    if (depth > maxDepth || out.length >= max) return
    let entries
    try { entries = readdirSync(join(cwd, d), { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (out.length >= max) return
      const rel = d ? `${d}/${e.name}` : e.name
      if (e.isDirectory()) { if (!SKIP.has(e.name) && !(e.name.startsWith('.') && !['.github', '.gitlab'].includes(e.name))) walk(rel, depth + 1) } else if (e.isFile() || (e.isSymbolicLink?.() && statSync(join(cwd, rel), { throwIfNoEntry: false })?.isFile())) out.push(rel)
    }
  }
  walk('', 0)
  return out.sort()
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
const npmHit = (deps, name) => (name.endsWith('/') ? Object.keys(deps).find((d) => d.startsWith(name)) : Object.hasOwn(deps, name) ? name : null)
const base = (f) => f.split('/').pop()
const dirGlob = (f) => { const d = dirname(f); return d === '.' ? null : `${d}/**` }

/** Python packages named in requirements*.txt or pyproject.toml (names only, lowercased). */
function pythonPackages(text) {
  return new Set([...text.matchAll(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:[<>=!~;[\s]|$)/gm), ...text.matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:[<>=!~;[]|["'])/g)].map((m) => m[1].toLowerCase().replace(/_/g, '-')))
}

/**
 * What the code shows: { tech, layer, name, evidence: [{ file, detail }], paths } per technology, plus providers.
 * @returns {{ detections: object[], providers: { provider: string, evidence: { file: string }[] }[] }}
 */
export function detectStack(cwd, { catalog = loadCatalog({ cwd }), files = listFiles(cwd) } = {}) {
  const found = new Map()
  const hit = (tech, file, detail, path) => {
    const t = catalog.technologies.get(tech)
    if (!t) return
    const e = found.get(tech) ?? { tech, layer: t.layer, name: t.name, evidence: [], paths: [] }
    if (!e.evidence.some((x) => x.file === file)) e.evidence.push({ file, detail })
    if (path && !e.paths.includes(path)) e.paths.push(path)
    found.set(tech, e)
  }
  for (const pkg of files.filter((f) => base(f) === 'package.json')) {
    const j = readJson(join(cwd, pkg))
    if (!j) continue
    const deps = { ...j.dependencies, ...j.devDependencies, ...j.peerDependencies }
    for (const r of RULES.filter((x) => x.npm)) {
      const names = r.npm.map((n) => npmHit(deps, n))
      if (r.all ? names.every(Boolean) : names.some(Boolean)) hit(r.tech, pkg, names.filter(Boolean).join(', '), dirGlob(pkg))
    }
  }
  for (const req of files.filter((f) => /^requirements[\w.-]*\.txt$|^pyproject\.toml$|^Pipfile$/.test(base(f)))) {
    let text = ''
    try { text = readFileSync(join(cwd, req), 'utf8') } catch { continue }
    const pkgs = pythonPackages(text)
    for (const r of RULES.filter((x) => x.py)) { const n = r.py.find((p) => pkgs.has(p)); if (n) hit(r.tech, req, n, dirGlob(req)) }
  }
  for (const r of RULES.filter((x) => x.files)) {
    for (const f of files) {
      if (r.files.some((g) => (g.includes('/') ? matches(f, g) : matches(base(f), g)))) hit(r.tech, f, 'file', r.root ? null : dirGlob(f))
    }
  }
  if (files.some((f) => /(^|\/)supabase\/migrations\//.test(f))) {
    const f = files.find((x) => /(^|\/)supabase\/migrations\//.test(x))
    if (found.has('drizzle-supabase-postgres') || !found.has('prisma-neon-postgres')) hit('drizzle-supabase-postgres', f, 'Supabase migrations', `${f.slice(0, f.indexOf('supabase/migrations/'))}supabase/migrations/**`)
  }
  const providers = PROVIDER_FILES.map((p) => ({ provider: p.provider, evidence: files.filter((f) => p.files.includes(base(f))).map((file) => ({ file })) })).filter((p) => p.evidence.length)
  return { detections: [...found.values()].sort((a, b) => a.layer.localeCompare(b.layer) || a.tech.localeCompare(b.tech)), providers }
}

const evidenceText = (d) => d.evidence.slice(0, 3).map((e) => (e.detail && e.detail !== 'file' ? `${e.file} (${e.detail})` : e.file)).join(', ')

/**
 * Where stack.yaml and the code disagree: a layer whose technology the code does not show while another one in that
 * layer is shown, technologies the code shows in a layer stack.yaml does not list, and layer paths that match nothing.
 */
export function stackDrift(cwd, { catalog = loadCatalog({ cwd }), files = listFiles(cwd) } = {}) {
  const file = join(cwd, 'stack.yaml')
  if (!existsSync(file)) return { stack: false, drift: [] }
  const stack = parse(readFileSync(file, 'utf8'), { file: 'stack.yaml' }) ?? {}
  const { detections } = detectStack(cwd, { catalog, files })
  const layers = Object.entries(stack.layers ?? {})
  const inUse = layers.filter(([, l]) => (l?.status ?? 'chosen') === 'chosen')
  const drift = []
  const detectable = new Set(RULES.map((r) => r.tech))
  for (const [layer, l] of inUse) {
    const shown = detections.filter((d) => d.layer === layer)
    if (l.tech && detectable.has(l.tech) && !shown.some((d) => d.tech === l.tech) && shown.length) {
      for (const d of shown) drift.push({ kind: 'mismatch', layer, stack: l.tech, code: d.tech, evidence: d.evidence, message: `stack.yaml says ${l.tech} for ${layer}, but the code uses ${d.name}: ${evidenceText(d)}`, fix: `agent-os stack set ${layer} ${d.tech}, or remove ${d.name} from the code` })
    }
    for (const p of Array.isArray(l.paths) ? l.paths : []) {
      if (!files.some((f) => matches(f, p))) drift.push({ kind: 'empty-path', layer, path: p, evidence: [], message: `${layer}: the path ${p} matches no file`, fix: 'fix the path in stack.yaml, or remove it' })
    }
  }
  const listed = new Set(layers.map(([id]) => id))
  for (const d of detections) {
    if (listed.has(d.layer)) continue
    drift.push({ kind: 'unlisted', layer: d.layer, code: d.tech, evidence: d.evidence, message: `the code uses ${d.name} (${d.layer}), which stack.yaml does not list: ${evidenceText(d)}`, fix: `agent-os stack set ${d.layer} ${d.tech}` })
  }
  return { stack: true, drift }
}

/** stack.yaml text from the detections, citing the evidence of each layer in its note. */
export function stackFromDetections({ detections }, { project } = {}) {
  const byLayer = new Map()
  for (const d of detections) if (!byLayer.has(d.layer)) byLayer.set(d.layer, d)
  const lines = ['# stack.yaml, detected by agent-os stack detect: check every layer, then agent-os stack check.', '']
  if (project) lines.push(`project: ${JSON.stringify(project)}`, '')
  lines.push('layers:')
  for (const [layer, d] of byLayer) {
    lines.push(`  ${layer}:`, `    tech: ${d.tech}`, '    status: chosen', `    paths: [${d.paths.map((p) => JSON.stringify(p)).join(', ')}]`, `    note: ${JSON.stringify(`detected from ${evidenceText(d)}`)}`)
  }
  return `${lines.join('\n')}\n`
}

