// Recommendations from the catalog: the blueprints for a product's complexity level, and a comparison of two
// technologies. Every recommendation cites the catalog scores it rests on (complexity, AI-friendliness, provider cost,
// learning curve, EU regions), so /kickoff and /stack explain their reasons instead of asserting them.

import { parse } from '../yaml/yaml.mjs'
import { stackFromBlueprint, stackSummary } from './stack.mjs'
import { comparisonTable } from './change.mjs'

const text = (v, lang) => (v && typeof v === 'object' ? v[lang] ?? v.en : v ?? '')

/** The blueprints for a level (nearest levels when there is none), with their summary scores, best fit first. */
export function proposeBlueprints(catalog, { level, family, lang = 'en' }) {
  const all = [...catalog.blueprints.values()].filter((b) => !family || b.family === family)
  const exact = all.filter((b) => b.level === level)
  const pool = exact.length ? exact : all.filter((b) => Math.abs(b.level - level) === Math.min(...all.map((x) => Math.abs(x.level - level))))
  return pool.map((b) => {
    const { summary } = stackSummary(parse(stackFromBlueprint(b)), catalog)
    const scores = { level: b.level, family: b.family, layers: summary.layers, languages: summary.languages, providers: summary.providers, averageComplexity: summary.averageComplexity, averageAiFriendly: summary.averageAiFriendly, averageProviderCost: summary.averageProviderCost, steepestLearningCurve: summary.steepestLearningCurve }
    const why = [
      `${text(b.description, lang)}.`,
      text(b.takeaway, lang),
      `Catalog scores: ${summary.layers} layers, average complexity ${summary.averageComplexity ?? '-'}/5, AI-friendliness ${summary.averageAiFriendly ?? '-'}/5, provider cost ${summary.averageProviderCost ?? '-'}/5, ${summary.languages.length} language(s) (${summary.languages.join(', ') || '-'}), steepest learning curve ${summary.steepestLearningCurve ? `${summary.steepestLearningCurve.language} ${summary.steepestLearningCurve.learningCurve}/5` : '-'}.`,
    ].filter(Boolean).join(' ')
    return { id: b.id, name: text(b.name, lang), exact: b.level === level, scores, why }
  }).sort((a, b) => (b.scores.averageAiFriendly ?? 0) - (a.scores.averageAiFriendly ?? 0) || (a.scores.averageComplexity ?? 9) - (b.scores.averageComplexity ?? 9))
}

/** Two technologies side by side, with the catalog scores of each. */
export function compareTech(catalog, a, b) {
  const s = (id) => {
    const t = catalog.technologies.get(id)
    const l = t?.language ? catalog.languages.get(t.language) : null
    const p = t?.provider ? catalog.providers.get(t.provider) : null
    return { tech: id, name: t?.name ?? id, layer: t?.layer ?? null, complexity: t?.complexity ?? null, aiFriendly: t?.aiFriendly ?? null, language: t?.language ?? null, learningCurve: l?.learningCurve ?? null, provider: t?.provider ?? null, cost: p?.cost ?? null, euRegions: p?.euRegions ?? null, note: t?.note?.en ?? null }
  }
  const x = s(a)
  const y = s(b)
  const notes = [x.layer && y.layer && x.layer !== y.layer ? `they belong to different layers (${x.layer}, ${y.layer})` : null]
  const prefer = []
  if ((x.aiFriendly ?? 0) !== (y.aiFriendly ?? 0)) prefer.push(`${(x.aiFriendly ?? 0) > (y.aiFriendly ?? 0) ? x.name : y.name} is better known to agents (AI-friendliness ${Math.max(x.aiFriendly ?? 0, y.aiFriendly ?? 0)} vs ${Math.min(x.aiFriendly ?? 0, y.aiFriendly ?? 0)})`)
  if ((x.complexity ?? 0) !== (y.complexity ?? 0)) prefer.push(`${(x.complexity ?? 9) < (y.complexity ?? 9) ? x.name : y.name} is simpler (complexity ${Math.min(x.complexity ?? 9, y.complexity ?? 9)} vs ${Math.max(x.complexity ?? 0, y.complexity ?? 0)})`)
  return { a: x, b: y, table: comparisonTable(x, y), reasons: [...prefer, ...notes.filter(Boolean)] }
}
