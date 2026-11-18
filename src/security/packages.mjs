// The project's dependencies, from its lockfiles: ecosystem, name, exact version, whether it is a direct dependency
// and whether it ships (not a development-only one). Read as text, nothing is installed or run. Used by the
// advisory watch (only names and versions leave the project) and by `agent-os sbom` (CycloneDX).

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { listFiles } from '../stack/detect.mjs'

const read = (cwd, f) => { try { return readFileSync(join(cwd, f), 'utf8') } catch { return null } }
const json = (cwd, f) => { try { return JSON.parse(read(cwd, f)) } catch { return null } }
const base = (f) => f.split('/').pop()

/** Direct dependencies declared next to a lockfile: name → 'prod' | 'dev'. */
function declared(cwd, dir) {
  const pkg = json(cwd, dir ? `${dir}/package.json` : 'package.json')
  const out = new Map()
  for (const n of Object.keys(pkg?.devDependencies ?? {})) out.set(n, 'dev')
  for (const n of Object.keys({ ...pkg?.dependencies, ...pkg?.optionalDependencies, ...pkg?.peerDependencies })) out.set(n, 'prod')
  return out
}

/** Every package in every lockfile, de-duplicated: { ecosystem, name, version, direct, dev, source }. */
export function inventory(cwd, { files = listFiles(cwd) } = {}) {
  const found = new Map()
  const add = (p) => {
    const k = `${p.ecosystem}|${p.name}|${p.version}`
    const prev = found.get(k)
    if (!prev) found.set(k, p)
    else { prev.direct ||= p.direct; prev.dev &&= p.dev }
  }
  for (const f of files) {
    const dir = dirname(f) === '.' ? '' : dirname(f)
    const name = base(f)
    if (name === 'package-lock.json') {
      const lock = json(cwd, f)
      const direct = declared(cwd, dir)
      for (const [path, p] of Object.entries(lock?.packages ?? {})) {
        if (!path || !p?.version) continue
        const n = p.name ?? path.split('node_modules/').pop()
        add({ ecosystem: 'npm', name: n, version: p.version, direct: direct.has(n) && path === `node_modules/${n}`, dev: Boolean(p.dev), source: f })
      }
      for (const [n, p] of Object.entries(lock?.dependencies ?? {})) if (p?.version && !lock.packages) add({ ecosystem: 'npm', name: n, version: p.version, direct: direct.has(n), dev: Boolean(p.dev), source: f })
    } else if (name === 'pnpm-lock.yaml') {
      const text = read(cwd, f) ?? ''
      const direct = declared(cwd, dir)
      for (const m of text.matchAll(/^ {2}['"]?\/?((?:@[^/@\s'"]+\/)?[^@\s'"/]+)@([0-9][^(:'"\s]*)/gm)) add({ ecosystem: 'npm', name: m[1], version: m[2], direct: direct.has(m[1]), dev: direct.get(m[1]) === 'dev', source: f })
    } else if (name === 'yarn.lock') {
      const text = read(cwd, f) ?? ''
      const direct = declared(cwd, dir)
      for (const m of text.matchAll(/^"?((?:@[^/@\s"]+\/)?[^@\s",]+)@[^\n]*:\n\s+version:? "?([^"\n]+)"?/gm)) add({ ecosystem: 'npm', name: m[1], version: m[2], direct: direct.has(m[1]), dev: direct.get(m[1]) === 'dev', source: f })
    } else if (/^requirements[\w.-]*\.txt$/.test(name)) {
      for (const m of (read(cwd, f) ?? '').matchAll(/^\s*([A-Za-z0-9][\w.-]*)(?:\[[^\]]*\])?\s*==\s*([\w.+!-]+)/gm)) add({ ecosystem: 'PyPI', name: m[1].toLowerCase(), version: m[2], direct: true, dev: /dev|test/i.test(name), source: f })
    } else if (name === 'poetry.lock' || name === 'uv.lock') {
      for (const m of (read(cwd, f) ?? '').matchAll(/\[\[package\]\]\s*\nname\s*=\s*"([^"]+)"\s*\nversion\s*=\s*"([^"]+)"/g)) add({ ecosystem: 'PyPI', name: m[1].toLowerCase(), version: m[2], direct: false, dev: false, source: f })
    } else if (name === 'Cargo.lock') {
      // Registry crates only: path and git dependencies are the project's own code.
      for (const m of (read(cwd, f) ?? '').matchAll(/\[\[package\]\]\s*\nname\s*=\s*"([^"]+)"\s*\nversion\s*=\s*"([^"]+)"\s*\nsource\s*=\s*"registry/g)) add({ ecosystem: 'crates.io', name: m[1], version: m[2], direct: false, dev: false, source: f })
    } else if (name === 'go.sum') {
      for (const m of (read(cwd, f) ?? '').matchAll(/^(\S+)\s+(v[^\s/]+)\s+h1:/gm)) add({ ecosystem: 'Go', name: m[1], version: m[2].replace(/\+incompatible$/, ''), direct: false, dev: false, source: f })
    }
  }
  return [...found.values()].sort((a, b) => a.ecosystem.localeCompare(b.ecosystem) || a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
}

const PURL = { npm: 'npm', PyPI: 'pypi', 'crates.io': 'cargo', Go: 'golang' }

/** A CycloneDX 1.5 SBOM of the inventory. */
export function sbom(packages, { name = 'project', version = '0.0.0', now = new Date() } = {}) {
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: { timestamp: now.toISOString(), tools: [{ name: 'agent-os' }], component: { type: 'application', name, version } },
    components: packages.map((p) => ({
      type: 'library',
      name: p.name,
      version: p.version,
      purl: `pkg:${PURL[p.ecosystem] ?? p.ecosystem.toLowerCase()}/${p.name.startsWith('@') ? `%40${p.name.slice(1)}` : p.name}@${p.version}`,
      scope: p.dev ? 'excluded' : 'required',
      properties: [{ name: 'agent-os:direct', value: String(p.direct) }, { name: 'agent-os:source', value: p.source }],
    })),
  }
}
