// Changing the stack map is an architecture decision: `stack set <layer> <tech>` and `stack status <layer> <status>`
// edit stack.yaml in place (comments and layout kept), write a decision record with the catalog's comparison of the
// old and new choice, and propose follow-up issues (never created here: /ticket or `issue new` does that).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { closest } from '../util/closest.mjs'
import { parse } from '../yaml/yaml.mjs'
import { newDecision } from '../decisions/decisions.mjs'
import { STATUSES } from './stack.mjs'

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Sets `key: value` on one layer of stack.yaml text, keeping everything else as it is. Handles block layers
 * (`  layer:` with indented keys), inline ones (`  layer: { tech: x, status: chosen }`) and a missing layer (appended).
 */
export function setLayerKey(text, layer, key, value) {
  const lines = text.split('\n')
  const layersAt = lines.findIndex((l) => /^layers:\s*(#.*)?$/.test(l))
  if (layersAt < 0) return `${text.replace(/\s*$/, '')}\n\nlayers:\n  ${layer}:\n    ${key}: ${value}\n`
  let i = layersAt + 1
  let layerIndent = null
  for (; i < lines.length; i++) {
    const l = lines[i]
    if (!l.trim() || /^\s*#/.test(l)) continue
    const ind = l.match(/^ */)[0].length
    if (ind === 0) break
    layerIndent ??= ind
    if (ind !== layerIndent) continue
    const m = l.match(new RegExp(`^(\\s*)${esc(layer)}:(\\s*)(.*)$`))
    if (!m) continue
    const rest = m[3]
    if (rest.startsWith('{')) {
      const close = rest.lastIndexOf('}')
      const inner = rest.slice(1, close)
      const re = new RegExp(`(^|,)(\\s*)${esc(key)}:\\s*[^,}]*?(\\s*)(?=,|$)`)
      const next = re.test(inner) ? inner.replace(re, `$1$2${key}: ${value}$3`) : `${inner.replace(/\s*$/, '')}, ${key}: ${value} `
      lines[i] = `${m[1]}${layer}:${m[2]}{${next}}${rest.slice(close + 1)}`
      return lines.join('\n')
    }
    // A block layer: find the key among its children, or add it as the first child.
    let j = i + 1
    let childIndent = null
    for (; j < lines.length; j++) {
      const c = lines[j]
      if (!c.trim() || /^\s*#/.test(c)) continue
      const ci = c.match(/^ */)[0].length
      if (ci <= layerIndent) break
      childIndent ??= ci
      if (ci === childIndent && new RegExp(`^\\s*${esc(key)}:`).test(c)) {
        lines[j] = c.replace(new RegExp(`^(\\s*${esc(key)}:\\s*)("[^"]*"|'[^']*'|[^#]*?)(\\s*(#.*)?)$`), `$1${value}$3`)
        return lines.join('\n')
      }
    }
    lines.splice(i + 1, 0, `${' '.repeat(childIndent ?? layerIndent + 2)}${key}: ${value}`)
    return lines.join('\n')
  }
  // Not there: append it at the end of the layers block.
  let end = lines.length
  while (end > layersAt + 1 && !lines[end - 1].trim()) end--
  lines.splice(end, 0, `${' '.repeat(layerIndent ?? 2)}${layer}:`, `${' '.repeat((layerIndent ?? 2) + 2)}${key}: ${value}`)
  return lines.join('\n')
}

/** One technology's scores, with its language and provider, for the comparison. */
function scores(catalog, techId, layer) {
  const t = techId ? catalog.technologies.get(techId) : null
  const language = layer?.language ?? t?.language ?? null
  const provider = layer?.provider ?? t?.provider ?? null
  const l = language ? catalog.languages.get(language) : null
  const p = provider ? catalog.providers.get(provider) : null
  return { tech: techId ?? null, name: t?.name ?? techId ?? '-', complexity: t?.complexity ?? null, aiFriendly: t?.aiFriendly ?? null, language, learningCurve: l?.learningCurve ?? null, provider, cost: p?.cost ?? null, euRegions: p?.euRegions ?? null }
}

/** The comparison table in Markdown: old and new, one row per score. */
export function comparisonTable(before, after) {
  const row = (label, a, b) => `| ${label} | ${a ?? '-'} | ${b ?? '-'} |`
  return [
    `| | ${before.name} | ${after.name} |`, '|---|---|---|',
    row('complexity (1 simple, 5 complex)', before.complexity, after.complexity),
    row('AI-friendliness (1 to 5)', before.aiFriendly, after.aiFriendly),
    row('language (learning curve)', before.language && `${before.language} (${before.learningCurve ?? '?'})`, after.language && `${after.language} (${after.learningCurve ?? '?'})`),
    row('provider (cost 1 to 5)', before.provider && `${before.provider} (${before.cost ?? '?'})`, after.provider && `${after.provider} (${after.cost ?? '?'})`),
    row('EU regions', before.euRegions, after.euRegions),
  ].join('\n')
}

const issue = (title, body) => ({ title, body })

/**
 * Plans (and with apply, makes) a change to one layer: stack.yaml, the decision record and the proposed issues.
 * @param {{ layer: string, tech?: string, status?: string, why?: string }} change
 */
export function changeLayer(cwd, catalog, { layer, tech, status, why }, { lang = 'en', now = new Date(), dryRun = false } = {}) {
  const file = join(cwd, 'stack.yaml')
  if (!existsSync(file)) throw new CliError('there is no stack.yaml', { hint: 'agent-os stack new --from <blueprint>' })
  if (!catalog.layers.has(layer)) { const near = closest(layer, [...catalog.layers.keys()]); throw new CliError(`unknown layer "${layer}"${near ? ` (did you mean "${near}"?)` : ''}`) }
  if (tech !== undefined && !catalog.technologies.has(tech)) { const near = closest(tech, [...catalog.technologies.keys()]); throw new CliError(`unknown technology "${tech}"${near ? ` (did you mean "${near}"?)` : ''}`, { hint: 'agent-os stack catalog; a project technology goes in .agent-os/catalog/technologies.yaml' }) }
  if (status !== undefined && !STATUSES.includes(status)) throw new CliError(`status must be ${STATUSES.join(', ')}, got "${status}"`)
  const text = readFileSync(file, 'utf8')
  const current = (parse(text, { file: 'stack.yaml' }) ?? {}).layers?.[layer] ?? null
  const was = { tech: current?.tech ?? null, status: current?.status ?? (current ? 'chosen' : null) }
  if (tech !== undefined && was.tech === tech) return { changed: false, layer, reason: `${layer} already uses ${tech}` }
  if (status !== undefined && was.status === status) return { changed: false, layer, reason: `${layer} is already ${status}` }
  let next = text
  if (tech !== undefined) next = setLayerKey(next, layer, 'tech', tech)
  if (status !== undefined) next = setLayerKey(next, layer, 'status', status)
  const check = (parse(next, { file: 'stack.yaml' }) ?? {}).layers?.[layer]
  if ((tech !== undefined && check?.tech !== tech) || (status !== undefined && (check?.status ?? 'chosen') !== status)) throw new CliError('stack.yaml could not be edited safely; change it by hand', { hint: `set ${layer}.${tech !== undefined ? 'tech' : 'status'} yourself, then run agent-os stack check` })

  const before = scores(catalog, was.tech, current)
  // Overrides in the layer (provider, language) stay in stack.yaml, so they apply to the new choice too.
  const after = scores(catalog, tech ?? was.tech, current)
  const layerName = catalog.layers.get(layer)?.name?.[lang] ?? catalog.layers.get(layer)?.name?.en ?? layer
  const title = tech !== undefined
    ? (was.tech ? `${layerName}: ${before.name} replaced by ${after.name}` : `${layerName}: ${after.name}`)
    : `${layerName}: ${after.name !== '-' ? `${after.name} ` : ''}${was.status ?? 'new'} → ${status}`
  const ro = lang === 'ro'
  const sections = {
    context: [
      ro ? `Stratul \`${layer}\` din stack.yaml${was.tech ? ` folosea ${before.name}` : ''}${was.status ? ` (stare: ${was.status})` : ''}.` : `The \`${layer}\` layer in stack.yaml${was.tech ? ` used ${before.name}` : ''}${was.status ? ` (status ${was.status})` : ''}.`,
      '', ro ? 'Comparatia din catalog:' : 'The catalog comparison:', '', comparisonTable(before, after),
    ].join('\n'),
    decision: [
      tech !== undefined ? (ro ? `\`${layer}\` foloseste ${after.name} (\`${tech}\`).` : `\`${layer}\` uses ${after.name} (\`${tech}\`).`) : (ro ? `\`${layer}\` trece in starea ${status}.` : `\`${layer}\` moves to ${status}.`),
      why ? `\n${why}` : (ro ? '\nDe ce: de completat.' : '\nWhy: to be written.'),
    ].join('\n'),
    consequences: (tech !== undefined && was.tech
      ? [ro ? `- Codul din ${(current?.paths ?? []).join(', ') || 'stratul acesta'} trece de la ${before.name} la ${after.name}.` : `- The code in ${(current?.paths ?? []).join(', ') || 'this layer'} moves from ${before.name} to ${after.name}.`,
        ...(before.provider !== after.provider ? [ro ? `- Providerul se schimba: ${before.provider ?? '-'} → ${after.provider ?? '-'} (cerintele din /env).` : `- The provider changes: ${before.provider ?? '-'} → ${after.provider ?? '-'} (requirements in /env).`] : []),
        ...(after.euRegions === 'verify' ? [ro ? '- Regiunile UE ale noului provider trebuie verificate.' : '- The new provider\'s EU regions must be verified.'] : [])]
      : [ro ? '- De completat.' : '- To be written.']).join('\n'),
  }
  const slug = `stack-${layer}-${tech ?? status}`
  const decision = newDecision(cwd, { slug, title, lang, sections, now, dryRun: true })
  const paths = (current?.paths ?? []).join(', ')
  const proposed = []
  if (tech !== undefined && was.tech) proposed.push(issue(`${layerName}: migrate from ${before.name} to ${after.name}`, `Implements the decision in ${decision.path}.\n\n## Scope\n\n- the code in ${paths || `the ${layer} layer`}\n- data and configuration that depend on ${before.name}\n\n## Acceptance criteria\n\n- [ ] nothing in ${paths || 'the layer'} uses ${before.name}\n- [ ] the layer's suites pass on ${after.name}\n\n## Test scenarios\n\n- [ ] Given the existing data, when it is migrated to ${after.name}, then every record reads back the same`))
  else if (tech !== undefined) proposed.push(issue(`${layerName}: set up ${after.name}`, `Implements the decision in ${decision.path}.`))
  if (status === 'chosen') proposed.push(issue(`${layerName}: adopt ${after.name}`, `Implements the decision in ${decision.path}: set the layer up and record its paths in stack.yaml.`))
  if (status === 'rejected' && paths) proposed.push(issue(`${layerName}: remove ${after.name}`, `Implements the decision in ${decision.path}: remove what remains in ${paths}.`))
  if (after.provider && after.provider !== before.provider) proposed.push(issue(`${layerName}: environment for ${after.provider}`, `The ${after.provider} CLI, MCP server or credentials the layer needs, in agent-os.json → requires (checked by agent-os env).`))
  if (!dryRun) {
    writeFileSync(file, next)
    newDecision(cwd, { slug, title, lang, sections, now })
  }
  return { changed: true, dryRun, layer, from: was, to: { tech: tech ?? was.tech, status: status ?? was.status ?? 'chosen' }, before, after, decision: decision.path, title, proposed }
}
