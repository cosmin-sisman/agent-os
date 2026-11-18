// `system detect`: drafts system.yaml from the repository's shape. Workspace packages (pnpm, npm or yarn workspaces,
// Turborepo on top of them, Nx projects, Go workspaces, Cargo and Maven multi-module projects) become components, and
// their dependencies on each other become `consumes` edges. Every item cites its evidence file. Exposure is read from
// platform configuration where it exists and otherwise asked, never guessed silently. Files are only read.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse } from '../yaml/yaml.mjs'
import { matches } from '../util/glob.mjs'
import { listFiles } from '../stack/detect.mjs'
import { areaLayers, layersOf } from '../stack/areas.mjs'

const read = (cwd, f) => { try { return readFileSync(join(cwd, f), 'utf8') } catch { return null } }
const json = (cwd, f) => { try { return JSON.parse(read(cwd, f)) } catch { return null } }
const dirOf = (f) => (dirname(f) === '.' ? '' : dirname(f))
const idOf = (name) => String(name).replace(/^@[^/]+\//, '').replace(/^.*\//, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root'
const inGlobs = (dir, globs) => globs.some((g) => matches(dir, g.replace(/^\.\//, '').replace(/\/$/, '')))
const KIND_BY_DIR = [[/^(apps|sites|web|frontend)\//, 'app'], [/^(services|api|backend|servers?)\//, 'service'], [/^(workers|jobs|queues)\//, 'worker'], [/^(packages|libs?|modules|crates|shared)\//, 'package']]
const SERVER = /^(hono|express|fastify|koa|@nestjs\/core|@hapi\/hapi|elysia|@trpc\/server)$/
const UI = /^(react|react-dom|next|vue|svelte|@sveltejs\/kit|astro|nuxt|@angular\/core|solid-js|expo|react-native)$/
/** The kind from the folder, refined by dependencies: a server framework and no UI in an app folder is a service. */
const kindOf = (path, deps = [], fallback = 'package') => {
  const k = KIND_BY_DIR.find(([re]) => re.test(`${path}/`))?.[1] ?? fallback
  return k === 'app' && deps.some((d) => SERVER.test(d)) && !deps.some((d) => UI.test(d)) ? 'service' : k
}
const EXPOSURE_FILES = [['vercel.json', 'public'], ['netlify.toml', 'public'], ['wrangler.toml', 'public'], ['wrangler.json', 'public'], ['fly.toml', 'public']]

/** Workspace members: { name, path, deps: names, evidence } for each tool that declares them. */
function members(cwd, files) {
  const out = []
  const pkgJsons = files.filter((f) => f.endsWith('package.json'))
  // pnpm (pnpm-workspace.yaml) or npm/yarn (package.json "workspaces").
  const root = json(cwd, 'package.json')
  const pnpm = read(cwd, 'pnpm-workspace.yaml')
  const globs = pnpm ? (parse(pnpm, { file: 'pnpm-workspace.yaml' })?.packages ?? []) : Array.isArray(root?.workspaces) ? root.workspaces : root?.workspaces?.packages ?? []
  if (globs.length) {
    const source = pnpm ? 'pnpm-workspace.yaml' : 'package.json (workspaces)'
    for (const f of pkgJsons) {
      const dir = dirOf(f)
      if (!dir || !inGlobs(dir, globs.filter((g) => !g.startsWith('!'))) || inGlobs(dir, globs.filter((g) => g.startsWith('!')).map((g) => g.slice(1)))) continue
      const p = json(cwd, f)
      if (!p) continue
      out.push({ tool: pnpm ? 'pnpm' : 'npm', name: p.name ?? dir, path: dir, deps: Object.keys({ ...p.dependencies, ...p.devDependencies, ...p.peerDependencies }), evidence: [f, source] })
    }
  }
  // Nx: project.json per project, with implicitDependencies.
  for (const f of files.filter((x) => x.endsWith('project.json') && x !== 'project.json')) {
    const p = json(cwd, f)
    if (!p?.name || out.some((m) => m.path === dirOf(f))) continue
    out.push({ tool: 'nx', name: p.name, path: dirOf(f), deps: p.implicitDependencies ?? [], evidence: [f] })
  }
  // Go workspaces: go.work "use" directives; dependencies are the require lines naming another member's module.
  const goWork = read(cwd, 'go.work')
  if (goWork) {
    const uses = [...goWork.matchAll(/^\s*(?:use\s+)?\.\/?([\w./-]+)\s*$/gm)].map((m) => m[1]).filter((d) => existsSync(join(cwd, d, 'go.mod')))
    for (const d of uses) {
      const mod = read(cwd, `${d}/go.mod`) ?? ''
      out.push({ tool: 'go', name: mod.match(/^module\s+(\S+)/m)?.[1] ?? d, path: d, deps: [...mod.matchAll(/^\s*(?:require\s+)?([\w.-]+\.[\w./-]+)\s+v[\d.]+/gm)].map((m) => m[1]), evidence: [`${d}/go.mod`, 'go.work'] })
    }
  }
  // Cargo: [workspace] members; dependencies with a path.
  const cargo = read(cwd, 'Cargo.toml')
  const cargoMembers = cargo?.match(/\[workspace\][\s\S]*?members\s*=\s*\[([\s\S]*?)\]/)?.[1]
  if (cargoMembers) {
    const globs2 = [...cargoMembers.matchAll(/"([^"]+)"/g)].map((m) => m[1])
    for (const f of files.filter((x) => x.endsWith('Cargo.toml') && x !== 'Cargo.toml')) {
      const dir = dirOf(f)
      if (!inGlobs(dir, globs2)) continue
      const t = read(cwd, f) ?? ''
      out.push({ tool: 'cargo', name: t.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1] ?? dir, path: dir, deps: [...t.matchAll(/^\s*([\w-]+)\s*=\s*\{[^}]*\bpath\s*=/gm)].map((m) => m[1]), evidence: [f, 'Cargo.toml'] })
    }
  }
  // Maven: <modules> in the root pom; dependencies by artifactId.
  const pom = read(cwd, 'pom.xml')
  if (pom && /<modules>/.test(pom)) {
    for (const d of [...pom.matchAll(/<module>\s*([^<\s]+)\s*<\/module>/g)].map((m) => m[1])) {
      const p = read(cwd, `${d}/pom.xml`)
      if (!p) continue
      const own = p.replace(/<parent>[\s\S]*?<\/parent>/, '').replace(/<dependencies>[\s\S]*<\/dependencies>/, '')
      out.push({ tool: 'maven', name: own.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1] ?? d, path: d, deps: [...(p.match(/<dependencies>([\s\S]*)<\/dependencies>/)?.[1] ?? '').matchAll(/<artifactId>([^<]+)<\/artifactId>/g)].map((m) => m[1]), evidence: [`${d}/pom.xml`, 'pom.xml'] })
    }
  }
  return out
}

/**
 * The repository's shape and a draft of its components: { shape, tools, components: { id: { kind, path, layer?,
 * exposure?, consumes, evidence } }, questions }. A component's exposure comes from a platform file in its folder,
 * or becomes a question.
 */
export function detectSystem(cwd, { files = listFiles(cwd) } = {}) {
  const found = members(cwd, files)
  // No workspaces: the root manifest is the one component (a library or CLI when it has no start script).
  if (!found.length) {
    const root = json(cwd, 'package.json')
    if (root) found.push({ tool: 'npm', name: root.name ?? 'app', path: '.', deps: [], evidence: ['package.json'], kind: root.scripts?.start || root.scripts?.dev ? 'app' : 'package' })
  }
  const layers = areaLayers(cwd)
  const components = {}
  const byName = new Map()
  for (const m of found) {
    let id = idOf(m.name)
    for (let n = 2; components[id]; n++) id = `${idOf(m.name)}-${n}`
    const kind = m.kind ?? kindOf(m.path, m.deps)
    const layer = layersOf(m.path === '.' ? 'x' : `${m.path}/x`, layers)[0]
    const inDir = (f) => (m.path === '.' ? f : `${m.path}/${f}`)
    const exposureFile = EXPOSURE_FILES.find(([f]) => files.includes(inDir(f)))
    components[id] = { kind, path: m.path, ...(layer ? { layer } : {}), ...(exposureFile ? { exposure: exposureFile[1] } : {}), consumes: [], evidence: [...m.evidence, ...(exposureFile ? [inDir(exposureFile[0])] : [])], deps: m.deps }
    byName.set(m.name, id)
  }
  for (const c of Object.values(components)) {
    c.consumes = [...new Set(c.deps.map((d) => byName.get(d)).filter(Boolean))].sort()
    c.edges = c.consumes.map((id) => ({ to: id, evidence: c.evidence[0] }))
    delete c.deps
  }
  const tools = [...new Set(found.map((m) => m.tool))]
  if (files.includes('turbo.json') && tools.length) tools.push('turborepo')
  const questions = Object.entries(components).filter(([, c]) => ['app', 'service'].includes(c.kind) && !c.exposure).map(([id, c]) => `${id} (${c.path}): is it public, internal or private? Nothing in its folder says (vercel.json, wrangler.toml, an ingress…).`)
  return { shape: found.length > 1 ? 'monorepo' : 'single app', tools, components, questions }
}

/** system.yaml text from a detection: each component with its evidence and open questions as comments. */
export function systemYaml(d) {
  const lines = [`# system.yaml, drafted by agent-os system detect (${d.shape}${d.tools.length ? `: ${d.tools.join(', ')}` : ''}). Check every component.`, '', 'components:']
  for (const [id, c] of Object.entries(d.components)) {
    lines.push(`  ${id}:`, `    # evidence: ${c.evidence.join(', ')}`, `    kind: ${c.kind}`, `    path: ${c.path}`)
    if (c.layer) lines.push(`    layer: ${c.layer}`)
    if (c.exposure) lines.push(`    exposure: ${c.exposure}`)
    else if (['app', 'service'].includes(c.kind)) lines.push('    # exposure: public | internal | private  (not detected: please fill in)')
    lines.push(`    consumes: [${c.consumes.join(', ')}]`)
  }
  if (!Object.keys(d.components).length) lines.push('  {}')
  return `${lines.join('\n').replace('components:\n  {}', 'components: {}')}\n`
}
