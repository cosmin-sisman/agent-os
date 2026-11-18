// Contract diffs: what a change does to the interfaces other components rely on. OpenAPI (YAML or JSON), AsyncAPI and
// GraphQL SDL are reduced to their surface (operations, parameters, request and response fields, channels and
// message fields, types and fields), and the before and after surfaces are compared. Removing anything a consumer
// can use is breaking, and so is making an input stricter; additions are not. A renamed endpoint is a removal plus an
// addition, so it is breaking.

import { parse } from '../yaml/yaml.mjs'

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace']
const MAX_DEPTH = 6

/** Reads a spec text (JSON or the YAML subset); null when it cannot be read. */
export function readSpec(text, file) {
  if (text === null || text === undefined) return null
  if (/\.graphqls?$|\.gql$/i.test(file)) return { kind: 'graphql', text }
  try { const doc = /^\s*[[{]/.test(text) ? JSON.parse(text) : parse(text, { file }); return doc && typeof doc === 'object' ? { kind: doc.asyncapi ? 'asyncapi' : doc.openapi || doc.swagger ? 'openapi' : 'unknown', doc } : null } catch { return null }
}

/** A local $ref (#/components/schemas/X) resolved, or the node itself. */
const deref = (doc, node, seen = new Set()) => {
  if (!node?.$ref || typeof node.$ref !== 'string' || !node.$ref.startsWith('#/') || seen.has(node.$ref)) return node
  seen.add(node.$ref)
  return deref(doc, node.$ref.slice(2).split('/').reduce((o, k) => o?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], doc), seen)
}

/** The fields of a schema as dotted paths, with whether each is required. */
function fields(doc, schema, prefix = '', depth = 0, out = new Map()) {
  const s = deref(doc, schema)
  if (!s || typeof s !== 'object' || depth > MAX_DEPTH) return out
  for (const part of [...(s.allOf ?? [])]) fields(doc, part, prefix, depth + 1, out)
  if (s.type === 'array' || s.items) fields(doc, s.items, `${prefix}[]`, depth + 1, out)
  const required = new Set(Array.isArray(s.required) ? s.required : [])
  for (const [name, sub] of Object.entries(s.properties ?? {})) {
    const path = prefix ? `${prefix}.${name}` : name
    out.set(path, { required: required.has(name) })
    fields(doc, sub, path, depth + 1, out)
  }
  return out
}

const contentSchema = (doc, c) => { const content = deref(doc, c)?.content ?? {}; const first = content['application/json'] ?? Object.values(content)[0]; return first?.schema }

/** The surface of a spec: a map of keys ("GET /users", "GET /users response.id") to { input, required }. */
export function surface(spec) {
  const out = new Map()
  if (!spec) return out
  if (spec.kind === 'openapi') {
    const doc = spec.doc
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
      for (const m of METHODS) {
        const op = item?.[m]
        if (!op) continue
        const key = `${m.toUpperCase()} ${path}`
        out.set(key, { input: false })
        for (const p of [...(item.parameters ?? []), ...(op.parameters ?? [])].map((x) => deref(doc, x)).filter(Boolean)) out.set(`${key} param ${p.in}:${p.name}`, { input: true, required: Boolean(p.required) })
        for (const [f, v] of fields(doc, contentSchema(doc, op.requestBody))) out.set(`${key} request ${f}`, { input: true, required: v.required })
        const ok = Object.entries(op.responses ?? {}).find(([code]) => /^2/.test(code))
        if (ok) for (const [f] of fields(doc, contentSchema(doc, ok[1]))) out.set(`${key} response ${f}`, { input: false })
      }
    }
  } else if (spec.kind === 'asyncapi') {
    const doc = spec.doc
    for (const [name, ch] of Object.entries(doc.channels ?? {})) {
      out.set(`channel ${name}`, { input: false })
      const messages = [ch?.publish?.message, ch?.subscribe?.message, ...Object.values(ch?.messages ?? {})].map((x) => deref(doc, x)).filter(Boolean)
      for (const msg of messages) for (const [f] of fields(doc, msg.payload)) out.set(`channel ${name} payload ${f}`, { input: false })
    }
  } else if (spec.kind === 'graphql') {
    const text = spec.text.replace(/#.*$/gm, '').replace(/"""[\s\S]*?"""/g, '')
    for (const m of text.matchAll(/\b(type|input|interface|enum)\s+(\w+)[^{]*\{([^}]*)\}/g)) {
      const [, kind, name, body] = m
      out.set(`${kind} ${name}`, { input: kind === 'input' })
      for (const line of body.split(/\n|,(?![^(]*\))/).map((l) => l.trim()).filter(Boolean)) {
        const f = line.match(/^(\w+)\s*(\(([^)]*)\))?\s*:?\s*([^\s@]*)/)
        if (!f) continue
        out.set(`${kind} ${name}.${f[1]}`, { input: kind === 'input', required: kind === 'input' && /!$/.test(f[4]) })
        for (const a of (f[3] ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
          const am = a.match(/^(\w+)\s*:\s*([^=\s]+)(\s*=)?/)
          if (am) out.set(`${kind} ${name}.${f[1]}(${am[1]})`, { input: true, required: /!$/.test(am[2]) && !am[3] })
        }
      }
    }
  }
  return out
}

/**
 * The changes between two versions of a spec: { breaking: [...], other: [...] }, each a sentence. Removed surface is
 * breaking; an input that becomes required, or a new required input, is breaking; anything added is not.
 */
export function diffContract(beforeText, afterText, file) {
  const before = surface(readSpec(beforeText, file))
  const after = surface(readSpec(afterText, file))
  const breaking = []
  const other = []
  for (const [k, v] of before) {
    if (!after.has(k)) breaking.push(`removed ${k}`)
    else if (v.input && !v.required && after.get(k).required) breaking.push(`${k} is now required`)
  }
  for (const [k, v] of after) {
    if (before.has(k)) continue
    if (v.input && v.required && [...before.keys()].some((b) => k.startsWith(`${b.split(' ').slice(0, 2).join(' ')} `) || k.startsWith(`${b}.`))) breaking.push(`added required ${k}`)
    else other.push(`added ${k}`)
  }
  return { breaking, other }
}

/** The spec files a system map names (provides: - http: { spec: … }), with their component. */
export function specFiles(system) {
  const out = []
  for (const [id, c] of Object.entries(system?.components ?? {})) {
    for (const p of Array.isArray(c?.provides) ? c.provides : []) {
      const iface = p && typeof p === 'object' ? Object.values(p)[0] : null
      if (iface?.spec) out.push({ component: id, spec: iface.spec, kind: Object.keys(p)[0] })
    }
  }
  return out
}

/** The components that consume a provider, with their owners (and the repo of the ones elsewhere). */
export function consumersOf(system, provider) {
  return Object.entries(system?.components ?? {}).filter(([id, c]) => id !== provider && (c?.consumes ?? []).includes(provider)).map(([id, c]) => ({ id, owners: c.owners ?? [], repo: c.repo ?? null, ref: c.ref ?? null }))
}

/**
 * The contract changes of a change request: for each spec in system.yaml that the diff touches, its breaking and other
 * changes, and the consumers to alert with their owners. A consumer in another repository with no owners listed here
 * has them read from that repository's system.yaml at its pinned ref (`ref`), through the tracker.
 * @param {{ cwd: string, git: Function, tracker?: object, readFile: (path: string) => string | null }} deps
 */
export function contractReview({ git, tracker, readFile }, { system, base, files }) {
  const changes = []
  for (const s of specFiles(system).filter((x) => files.includes(x.spec))) {
    const before = git(['show', `origin/${base}:${s.spec}`])
    const d = diffContract(before.status === 0 ? before.stdout : null, readFile(s.spec), s.spec)
    if (!d.breaking.length && !d.other.length) continue
    const consumers = consumersOf(system, s.component).map((c) => {
      if (c.owners.length || !c.repo || !tracker?.fileAt) return c
      try {
        const remote = parse(tracker.fileAt(c.repo, 'system.yaml', c.ref) ?? '', { file: `${c.repo}/system.yaml` }) ?? {}
        const owners = [...new Set(Object.values(remote.components ?? {}).filter((x) => (x?.consumes ?? []).includes(s.component)).flatMap((x) => x.owners ?? []))]
        return { ...c, owners, from: `${c.repo}@${c.ref ?? 'default branch'}` }
      } catch { return c }
    })
    changes.push({ component: s.component, spec: s.spec, ...d, consumers })
  }
  const breaking = changes.some((c) => c.breaking.length)
  const owners = breaking ? [...new Set(changes.filter((c) => c.breaking.length).flatMap((c) => c.consumers.flatMap((x) => x.owners)))] : []
  return { changes, breaking, owners }
}
