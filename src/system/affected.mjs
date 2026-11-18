// The affected graph: which components a diff touches, directly or through what depends on them. The graph is
// system.yaml's components and edges when the file exists, else the workspaces `system detect` reads, so the laptop
// and CI, given the same files and diff, compute the same set. The gate runs only the affected components' suites.

import { readSystem } from './system.mjs'
import { detectSystem } from './detect.mjs'

/** The graph: { components: { id: { path, consumes } }, source }. */
export function componentGraph(cwd) {
  const system = readSystem(cwd)
  if (system?.components) return { source: 'system.yaml', components: Object.fromEntries(Object.entries(system.components).filter(([, c]) => c?.path !== undefined).map(([id, c]) => [id, { path: String(c.path).replace(/\/+$/, ''), consumes: c.consumes ?? [] }])) }
  const d = detectSystem(cwd)
  return { source: 'workspaces', components: Object.fromEntries(Object.entries(d.components).map(([id, c]) => [id, { path: c.path, consumes: c.consumes }])) }
}

/** The component a file belongs to: the one with the longest path that contains it ('.' only as a last resort). */
export function ownerOf(file, components) {
  let best = null
  for (const [id, c] of Object.entries(components)) {
    const p = c.path === '.' || c.path === '' ? '' : `${c.path}/`
    if ((p === '' || file.startsWith(p)) && (!best || p.length > best.len)) best = { id, len: p.length }
  }
  return best?.id ?? null
}

/**
 * The affected components for changed files: those that contain a changed file (`changed`), plus every component
 * that depends on one of them, transitively (`affected`). Sorted, so the same input always gives the same set.
 */
export function affectedBy(files, graph) {
  const comps = graph.components
  const changed = [...new Set(files.map((f) => ownerOf(f, comps)).filter(Boolean))].sort()
  const dependents = new Map(Object.keys(comps).map((id) => [id, []]))
  for (const [id, c] of Object.entries(comps)) for (const dep of c.consumes) if (dependents.has(dep)) dependents.get(dep).push(id)
  const seen = new Set(changed)
  const queue = [...changed]
  const via = {}
  while (queue.length) {
    const id = queue.shift()
    for (const d of dependents.get(id) ?? []) if (!seen.has(d)) { seen.add(d); via[d] = id; queue.push(d) }
  }
  const outside = files.filter((f) => !ownerOf(f, comps))
  return { changed, affected: [...seen].sort(), via, outside }
}
