// The endpoint inventory: every route the code declares and every operation the specs document, side by side.
// Routes are read from source files by framework-specific patterns (nothing is run); each has its method, path,
// component, file and line, whether an authentication marker is visible, and whether a spec documents it. Frameworks
// the project uses but agent-os cannot read yet are reported, never silently skipped. Rendered on demand into the
// cache, never committed.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFiles } from '../stack/detect.mjs'
import { componentGraph, ownerOf } from './affected.mjs'
import { readSystem } from './system.mjs'
import { readSpec, specFiles } from './contracts.mjs'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
// Word markers need a boundary; annotation markers start with @ or [, where \b does not apply.
const AUTH = /\b(auth|authenticate|requireAuth|requireUser|isAuthenticated|protect(ed)?|jwt|bearer|session|verifyToken|clerkMiddleware|login_required|permission_classes|RequireAuthorization)\b|Depends\(\s*get_current_\w+|Security\(|@PreAuthorize|@Secured|@RolesAllowed|\[Authorize|before_action\s+:authenticate/i

/** A path normalized for comparison: :id, {id}, <id>, [id] and <int:id> all become {}. Trailing slashes dropped. */
export const normPath = (p) => (`/${String(p).replace(/^\/+/, '')}`.replace(/\/+$/, '') || '/').replace(/\[\.\.\.\w+\]|\[\[\.\.\.\w+\]\]/g, '{*}').replace(/:[A-Za-z_]\w*\??|\{[^}]+\}|<(?:\w+:)?\w+>|\[\w+\]/g, '{}')

const route = (method, path, file, line, text) => ({ method: method.toUpperCase(), path, file, line, auth: AUTH.test(text) ? 'marked' : 'unknown' })
const lineOf = (src, index) => src.slice(0, index).split('\n').length
const lineText = (src, index) => src.slice(src.lastIndexOf('\n', index) + 1, src.indexOf('\n', index) === -1 ? undefined : src.indexOf('\n', index))

/** Framework extractors: which files they read and how they find routes. */
const EXTRACTORS = [
  {
    id: 'express-hono-fastify-koa',
    deps: ['express', 'hono', 'fastify', 'koa', '@koa/router', 'elysia'],
    files: /\.(m?[jt]sx?|cjs)$/,
    read(src, file) {
      return [...src.matchAll(/\b\w+\.(get|post|put|patch|delete|head|options|all)\(\s*(['"`])(\/[^'"`]*)\2/g)].map((m) => route(m[1] === 'all' ? 'ANY' : m[1], m[3], file, lineOf(src, m.index), lineText(src, m.index)))
    },
  },
  {
    id: 'nestjs',
    deps: ['@nestjs/core'],
    files: /\.ts$/,
    read(src, file) {
      const prefix = src.match(/@Controller\(\s*['"`]([^'"`]*)['"`]/)?.[1] ?? ''
      const guard = /@UseGuards\(/.test(src)
      return [...src.matchAll(/@(Get|Post|Put|Patch|Delete|Head|Options)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g)].map((m) => ({ ...route(m[1], `/${[prefix, m[2] ?? ''].filter(Boolean).join('/')}`.replace(/\/+/g, '/'), file, lineOf(src, m.index), lineText(src, m.index)), ...(guard ? { auth: 'marked' } : {}) }))
    },
  },
  {
    id: 'next',
    deps: ['next'],
    files: /(^|\/)(app\/.*\/route|pages\/api\/.*)\.(m?[jt]sx?)$/,
    read(src, file) {
      const pages = file.match(/(?:^|\/)pages\/(api\/.*)\.(m?[jt]sx?)$/)
      const app = file.match(/(?:^|\/)app\/(.*)\/route\.(m?[jt]sx?)$/)
      const path = `/${(pages ? pages[1].replace(/\/index$/, '') : app[1]).split('/').filter((s) => !/^\(.*\)$/.test(s)).join('/')}`
      const methods = [...src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1])
      return (methods.length ? methods : ['ANY']).map((m) => route(m, path, file, 1, src))
    },
  },
  {
    id: 'astro',
    deps: ['astro'],
    files: /(^|\/)src\/pages\/.*\.(m?[jt]s)$/,
    read(src, file) {
      const path = `/${file.match(/src\/pages\/(.*)\.(m?[jt]s)$/)[1].replace(/\/?index$/, '')}`
      return [...src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|ALL)\b/g)].map((m) => route(m[1] === 'ALL' ? 'ANY' : m[1], path, file, lineOf(src, m.index), src))
    },
  },
  {
    id: 'fastapi',
    py: ['fastapi'],
    files: /\.py$/,
    read(src, file) {
      // The decorator's own arguments and the whole signature (up to "):"), where Depends(get_current_user) sits.
      return [...src.matchAll(/@\w+\.(get|post|put|patch|delete|head|options)\(\s*['"]([^'"]+)['"]([^)]*)\)/g)].map((m) => { const def = src.indexOf('def ', m.index); const end = def < 0 ? -1 : src.indexOf('):', def); return route(m[1], m[2], file, lineOf(src, m.index), `${m[3]} ${def < 0 ? '' : src.slice(def, end < 0 ? def + 400 : end + 2)}`) })
    },
  },
  {
    id: 'django',
    py: ['django'],
    files: /(^|\/)urls\.py$/,
    read(src, file) {
      return [...src.matchAll(/\b(?:re_)?path\(\s*r?['"]([^'"]*)['"]/g)].map((m) => route('ANY', `/${m[1].replace(/^\^|\$$/g, '')}`, file, lineOf(src, m.index), lineText(src, m.index)))
    },
  },
  {
    id: 'rails',
    files: /(^|\/)config\/routes\.rb$/,
    read(src, file) {
      const out = [...src.matchAll(/^\s*(get|post|put|patch|delete)\s+['"]([^'"]+)['"]/gm)].map((m) => route(m[1], m[2].startsWith('/') ? m[2] : `/${m[2]}`, file, lineOf(src, m.index), lineText(src, m.index)))
      for (const m of src.matchAll(/^\s*resources?\s+:(\w+)/gm)) {
        const base = `/${m[1]}`
        for (const [method, p] of [['GET', base], ['POST', base], ['GET', `${base}/:id`], ['PATCH', `${base}/:id`], ['PUT', `${base}/:id`], ['DELETE', `${base}/:id`]]) out.push(route(method, p, file, lineOf(src, m.index), ''))
      }
      return out
    },
  },
  {
    id: 'spring',
    files: /\.(java|kt)$/,
    read(src, file) {
      const prefix = src.match(/@RequestMapping\(\s*(?:value\s*=\s*|path\s*=\s*)?["']([^"']*)["']\s*\)\s*(?:public\s+)?(?:class|@)/)?.[1] ?? ''
      // Annotations around the mapping (before it or between it and the method) carry @PreAuthorize or @Secured.
      return [...src.matchAll(/@(Get|Post|Put|Patch|Delete)Mapping\(\s*(?:value\s*=\s*|path\s*=\s*)?["']?([^"')]*)["']?\s*\)/g)].map((m) => { const after = src.slice(m.index); const body = after.search(/\)\s*\{/); return route(m[1], `/${[prefix, m[2]].filter(Boolean).join('/')}`.replace(/\/+/g, '/'), file, lineOf(src, m.index), `${src.slice(Math.max(0, m.index - 200), m.index)}${after.slice(0, body < 0 ? 200 : body)}`) })
    },
  },
  {
    id: 'aspnet',
    files: /\.cs$/,
    read(src, file) {
      const out = [...src.matchAll(/\b\w+\.Map(Get|Post|Put|Patch|Delete)\(\s*"([^"]+)"/g)].map((m) => route(m[1], m[2], file, lineOf(src, m.index), lineText(src, m.index)))
      const prefix = (src.match(/\[Route\(\s*"([^"]*)"\s*\)\]\s*(?:\[[^\]]*\]\s*)*public\s+(?:\w+\s+)*class\s+(\w+?)(?:Controller)?\b/) ?? [])
      const base = prefix[1] ? prefix[1].replace(/\[controller\]/gi, (prefix[2] ?? '').toLowerCase()) : ''
      for (const m of src.matchAll(/\[Http(Get|Post|Put|Patch|Delete)(?:\(\s*"([^"]*)"\s*\))?\]/g)) out.push(route(m[1], `/${[base, m[2] ?? ''].filter(Boolean).join('/')}`.replace(/\/+/g, '/'), file, lineOf(src, m.index), src.slice(Math.max(0, m.index - 300), m.index + 50)))
      return out
    },
  },
  {
    id: 'go',
    files: /\.go$/,
    read(src, file) {
      const out = [...src.matchAll(/\b\w+\.(GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete)\(\s*"(\/[^"]*)"/g)].map((m) => route(m[1], m[2], file, lineOf(src, m.index), lineText(src, m.index)))
      for (const m of src.matchAll(/\b\w+\.HandleFunc\(\s*"(?:(GET|POST|PUT|PATCH|DELETE)\s+)?(\/[^"]*)"/g)) out.push(route(m[1] ?? 'ANY', m[2], file, lineOf(src, m.index), lineText(src, m.index)))
      return out
    },
  },
]

/** Frameworks agent-os sees in a project but has no extractor for: they are reported. */
const UNREAD = { remix: ['@remix-run/node', '@remix-run/react'], sveltekit: ['@sveltejs/kit'], nuxt: ['nuxt'], 'react-router': ['@react-router/node'], laravel: [], phoenix: [], adonis: ['@adonisjs/core'], 'trpc (procedures, not paths)': ['@trpc/server'], graphql: ['graphql-yoga', '@apollo/server', 'mercurius'] }

const read = (cwd, f) => { try { return readFileSync(join(cwd, f), 'utf8') } catch { return null } }

/** What the project depends on: npm package names and Python packages, across its manifests. */
function dependencies(cwd, files) {
  const npm = new Set()
  const py = new Set()
  for (const f of files.filter((x) => x.endsWith('package.json'))) { try { const j = JSON.parse(read(cwd, f)); for (const k of Object.keys({ ...j.dependencies, ...j.devDependencies })) npm.add(k) } catch { /* not JSON */ } }
  for (const f of files.filter((x) => /(^|\/)(requirements[\w.-]*\.txt|pyproject\.toml)$/.test(x))) for (const m of (read(cwd, f) ?? '').matchAll(/^\s*["']?([A-Za-z][\w.-]*)/gm)) py.add(m[1].toLowerCase())
  return { npm, py, files: new Set(files) }
}

/** The operations the specs document: method, normalized path, the spec file. */
function documented(cwd, files) {
  const system = readSystem(cwd)
  const specs = new Set([...specFiles(system).map((s) => s.spec), ...files.filter((f) => /(^|\/)(openapi|swagger)[\w.-]*\.(ya?ml|json)$/i.test(f))])
  const out = []
  for (const f of specs) {
    const spec = readSpec(read(cwd, f), f)
    if (spec?.kind !== 'openapi') continue
    for (const [path, item] of Object.entries(spec.doc.paths ?? {})) for (const m of Object.keys(item ?? {})) if (METHODS.includes(m.toUpperCase())) out.push({ method: m.toUpperCase(), path, norm: normPath(path), spec: f })
  }
  return { specs: [...specs], operations: out }
}

/**
 * The inventory: { endpoints: [{ method, path, component, file, line, auth, documented, spec? }], specOnly: operations
 * no code declares, frameworks: the extractors used, unread: frameworks in use that agent-os cannot read }.
 */
export function inventory(cwd, { files = listFiles(cwd) } = {}) {
  const deps = dependencies(cwd, files)
  const graph = componentGraph(cwd)
  const used = EXTRACTORS.filter((e) => (e.deps ?? []).some((d) => deps.npm.has(d)) || (e.py ?? []).some((d) => deps.py.has(d)) || (!e.deps && !e.py && files.some((f) => e.files.test(f))))
  const routes = []
  for (const e of used) for (const f of files.filter((x) => e.files.test(x) && !/(^|\/)(test|tests|__tests__|spec)\//.test(x) && !/\.(test|spec)\.[^/]+$/.test(x))) {
    const src = read(cwd, f)
    if (src) for (const r of e.read(src, f)) routes.push({ ...r, framework: e.id })
  }
  const { specs, operations } = documented(cwd, files)
  const key = (m, p) => `${m} ${normPath(p)}`
  const docKeys = new Set(operations.map((o) => `${o.method} ${o.norm}`))
  const docPaths = new Set(operations.map((o) => o.norm))
  const seen = new Set()
  const endpoints = []
  for (const r of routes) {
    const k = `${key(r.method, r.path)} ${r.file}`
    if (seen.has(k)) continue
    seen.add(k)
    endpoints.push({ ...r, component: ownerOf(r.file, graph.components), documented: r.method === 'ANY' ? docPaths.has(normPath(r.path)) : docKeys.has(key(r.method, r.path)) })
  }
  const codeKeys = new Set(endpoints.flatMap((e) => (e.method === 'ANY' ? METHODS.map((m) => key(m, e.path)) : [key(e.method, e.path)])))
  const specOnly = operations.filter((o) => !codeKeys.has(`${o.method} ${o.norm}`))
  const unread = Object.entries(UNREAD).filter(([, pkgs]) => pkgs.some((p) => deps.npm.has(p))).map(([id]) => id)
  if (files.includes('artisan')) unread.push('laravel')
  if (files.some((f) => /(^|\/)mix\.exs$/.test(f))) unread.push('phoenix')
  endpoints.sort((a, b) => (a.component ?? '').localeCompare(b.component ?? '') || normPath(a.path).localeCompare(normPath(b.path)) || a.method.localeCompare(b.method))
  return { endpoints, specOnly, specs, frameworks: used.map((e) => e.id), unread: [...new Set(unread)] }
}
