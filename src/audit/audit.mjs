// /audit's deterministic half (design §21): the subject (idea, spec, project, release, problem, system) detected from
// what was passed and confirmed with the person; the lenses its preset picks, each with the brief its own subagent
// works from; and the findings model: every finding has evidence or it becomes a question, severity and confidence
// are separate, duplicates across lenses merge, one recommendation each, and strengths are reported too.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { loadCatalog } from '../stack/catalog.mjs'

export const SUBJECTS = ['idea', 'spec', 'project', 'release', 'problem', 'system']
export const SEVERITIES = ['critical', 'high', 'medium', 'low']
export const CONFIDENCES = ['confirmed', 'likely', 'to verify']

/** The lenses: what each asks and the checklist its subagent works through. */
export const LENSES = {
  product: { asks: 'Is the problem real, and is the scope right? What is missing for the users?', checklist: ['who has the problem and how they solve it today', 'the smallest version that is useful', 'what the users will miss first', 'what is in scope that should not be'] },
  architecture: { asks: 'Do the layers fit the level? Where are the boundaries, the coupling and the single points of failure?', checklist: ['layers against the complexity level', 'boundaries and contracts between components', 'coupling and shared state', 'single points of failure'] },
  stack: { asks: 'Do the technologies fit the team and the level? Where are drift, AI-unfriendly layers and EU-region gaps?', checklist: ['catalog scores of each layer (complexity, AI-friendliness, cost)', 'stack drift against the code', 'layers agents know poorly', 'EU regions when compliance requires them'] },
  'code-quality': { asks: 'Does the code meet the standards? Where are duplication, dead code, missing headers and risky patterns?', checklist: ['the standards (headers, size, TODOs, comments)', 'duplication and dead code', 'risky patterns in hot paths', 'tests for the logic that matters'] },
  'security-privacy': { asks: 'Are authorization, secrets, data exposure, dependencies and personal data handled?', checklist: ['authorization on every path', 'secrets out of code and bundles', 'exposed data and personal data', 'known-vulnerable dependencies (the advisory watch)'] },
  'performance-cost': { asks: 'What happens at the expected load? What do the providers cost?', checklist: ['the expected load and the slow paths', 'queries, caches and timeouts', 'provider costs (catalog) at that load', 'what grows with the number of users'] },
  delivery: { asks: 'What are the CI, tests, release flow and environments like, and what is the bus factor?', checklist: ['CI and the required checks', 'test coverage of the scenarios', 'the release flow and environments', 'who can ship when one person is away'] },
  process: { asks: 'How is the issue hygiene? Do PRs and MRs follow the conventions? Is the loop alive?', checklist: ['issues with type, priority and milestone', 'change requests that follow the conventions', 'journal, lessons and retro in use', 'blocked or stale work'] },
  operations: { asks: 'Monitoring, backups, incident readiness, runbooks?', checklist: ['monitoring and alerts', 'backups and restore tests', 'incident readiness', 'runbooks for the common failures'] },
}

const PRESETS = {
  idea: ['product', 'architecture', 'stack', 'performance-cost'],
  spec: ['product', 'architecture', 'security-privacy', 'delivery'],
  project: Object.keys(LENSES),
  release: ['security-privacy', 'delivery', 'operations', 'code-quality'],
  system: ['architecture', 'security-privacy', 'performance-cost', 'operations'],
}

/** The lenses that matter for a problem in a layer group. */
const LENSES_BY_GROUP = {
  data: ['architecture', 'performance-cost', 'security-privacy', 'operations'],
  api: ['architecture', 'security-privacy', 'performance-cost', 'code-quality'],
  frontend: ['product', 'code-quality', 'performance-cost'],
  auth: ['security-privacy', 'architecture', 'operations'],
  ci: ['delivery', 'process'],
  infra: ['operations', 'performance-cost', 'security-privacy'],
}
const GROUP_OF_LAYER = { 'data-layer': 'data', storage: 'data', 'cache-queue': 'data', 'internal-api': 'api', 'public-api-webhooks': 'api', 'backend-services': 'api', 'background-workers': 'api', realtime: 'api', 'public-frontend': 'frontend', 'internal-frontend': 'frontend', mobile: 'frontend', auth: 'auth', 'ci-cd': 'ci', infrastructure: 'infra', monitoring: 'infra' }
/** Words that point a problem at a layer, beyond the layer names in the catalog. */
const PROBLEM_WORDS = [
  [/\b(database|db|sql|queries|query|migration|postgres|mysql|index|deadlock|schema|tabel|baza de date|interogar)/i, 'data-layer'],
  [/\b(login|logout|session|token|password|sso|oauth|auth|parola|autentificar)/i, 'auth'],
  [/\b(build|pipeline|ci|deploy|workflow|release)\b/i, 'ci-cd'],
  [/\b(page|ui|render|button|css|layout|frontend|pagina|ecran)\b/i, 'internal-frontend'],
  [/\b(api|endpoint|webhook|request|timeout|500|latency)\b/i, 'internal-api'],
  [/\b(server|container|docker|kubernetes|memory|cpu|disk|infra)\b/i, 'infrastructure'],
]
const PROBLEM = /\b(fails?|failing|broken|slow|slower|crash(es|ed)?|error|errors|bug|down|leak|timeout|cannot|can't|doesn't|stuck|nu merge|lent|eroare|cade|blocat)\b/i
const CODE_EXT = /\.(m?[jt]sx?|py|go|rs|java|kt|cs|rb|php|swift|vue|svelte)$/

const hasCode = (dir, depth = 0) => {
  if (depth > 3) return false
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return false }
  return entries.some((e) => (e.isFile() && CODE_EXT.test(e.name)) || (e.isDirectory() && !['node_modules', '.git'].includes(e.name) && !e.name.startsWith('.') && hasCode(join(dir, e.name), depth + 1)))
}

/** The layers a problem's description points at, from catalog names and common words. */
export function layersInText(text, catalog = loadCatalog()) {
  const out = new Set()
  for (const l of catalog.layers.values()) for (const n of [l.id, l.name?.en, l.name?.ro].filter(Boolean)) if (new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\b`, 'i').test(text)) out.add(l.id)
  for (const [re, layer] of PROBLEM_WORDS) if (re.test(text)) out.add(layer)
  return [...out].sort()
}

/** The subject of what was passed, with why and the question to confirm it. */
export function detectSubject(input, { cwd = process.cwd(), catalog } = {}) {
  const text = String(input ?? '').trim()
  if (!text) throw new CliError('what should be audited?', { hint: 'an idea in words, a folder, ".", "release", an issue (#N) or a problem ("login fails for some users")' })
  const path = join(cwd, text)
  let subject
  let why
  if (/^release$/i.test(text) || /^v?\d+\.\d+\.\d+$/.test(text)) { subject = 'release'; why = 'what is about to ship since the last tag' }
  else if (/^[#!]\d+$/.test(text)) { subject = 'problem'; why = `the issue or change request ${text}, its thread and the code around it` }
  else if (existsSync(path) && statSync(path).isDirectory()) {
    const code = hasCode(path)
    subject = code ? 'project' : 'spec'
    why = code ? `${text === '.' ? 'this repository' : text}: code, stack, history, issues, CI` : `${text}: documents, checked for contradictions, gaps and assumptions`
  } else if (/\b(system|across|end to end|between (the )?(layers|services|components))\b/i.test(text) && layersInText(text, catalog).length > 1) { subject = 'system'; why = 'a question across several layers, one sub-audit per layer' }
  else if (PROBLEM.test(text)) { subject = 'problem'; why = 'a symptom: the scope narrows to the layers it involves' }
  else { subject = 'idea'; why = 'a description of something to build' }
  const layers = ['problem', 'system'].includes(subject) ? layersInText(text, catalog) : []
  return { subject, why, layers, question: `Audit this as ${subject === 'idea' ? 'an idea' : `a ${subject}`} (${why})? Or as one of: ${SUBJECTS.filter((s) => s !== subject).join(', ')}.` }
}

/** The lenses for a subject: its preset, or for a problem the lenses of the layers it involves; then additions and removals. */
export function lensesFor(subject, { layers = [], add = [], remove = [] } = {}) {
  if (!SUBJECTS.includes(subject)) throw new CliError(`unknown subject "${subject}"`, { hint: SUBJECTS.join(', ') })
  for (const l of [...add, ...remove]) if (!LENSES[l]) throw new CliError(`unknown lens "${l}"`, { hint: Object.keys(LENSES).join(', ') })
  let base
  if (subject === 'problem') {
    const groups = [...new Set(layers.map((l) => GROUP_OF_LAYER[l]).filter(Boolean))]
    base = groups.length ? [...new Set(groups.flatMap((g) => LENSES_BY_GROUP[g]))] : ['architecture', 'code-quality', 'operations']
  } else base = PRESETS[subject]
  const order = Object.keys(LENSES)
  return [...new Set([...base, ...add])].filter((l) => !remove.includes(l)).sort((a, b) => order.indexOf(a) - order.indexOf(b))
}

/** The brief one lens's subagent works from: the subject, the question, the checklist and the findings format. */
export function lensBrief(lens, { subject, input, layers = [] }) {
  const l = LENSES[lens]
  return [
    `You audit "${input}" (${subject}${layers.length ? `; layers: ${layers.join(', ')}` : ''}) through the ${lens} lens only: ${l.asks}`,
    '', 'Work through:', ...l.checklist.map((c) => `- ${c}`),
    '', 'Answer with JSON only: {"lens": "' + lens + '", "findings": [...], "strengths": [...]}.',
    'Each finding: {"title", "evidence": ["path:line" | a command and its output | "#N" | a catalog score | a quote], "severity": critical|high|medium|low, "confidence": confirmed|likely|to verify, "recommendation", "alternatives": [...]}.',
    'Evidence is required: what you cannot point at, put as {"question": "..."} instead of a finding. Strengths are short sentences with evidence too.',
  ].join('\n')
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Merges the lenses' answers into one report: findings with evidence (deduplicated across lenses, each keeping every
 * lens that raised it), questions (findings without evidence, and the questions the lenses asked), strengths.
 */
export function mergeFindings(answers) {
  const findings = []
  const questions = []
  const strengths = []
  const problems = []
  for (const a of answers) {
    const lens = a?.lens ?? 'unknown'
    for (const f of a?.findings ?? []) {
      if (f?.question) { questions.push({ lens, question: String(f.question) }); continue }
      const evidence = (Array.isArray(f?.evidence) ? f.evidence : f?.evidence ? [f.evidence] : []).map(String).filter((e) => e.trim())
      if (!evidence.length) { questions.push({ lens, question: `${f?.title ?? 'a finding'}: what shows it? (raised without evidence)` }); continue }
      const severity = SEVERITIES.includes(f.severity) ? f.severity : (problems.push(`${lens}: "${f.title}" has no valid severity; medium used`), 'medium')
      const confidence = CONFIDENCES.includes(f.confidence) ? f.confidence : 'to verify'
      const same = findings.find((x) => norm(x.title) === norm(f.title) || x.evidence.some((e) => evidence.includes(e)))
      if (same) {
        same.lenses = [...new Set([...same.lenses, lens])]
        same.evidence = [...new Set([...same.evidence, ...evidence])]
        if (SEVERITIES.indexOf(severity) < SEVERITIES.indexOf(same.severity)) same.severity = severity
        if (CONFIDENCES.indexOf(confidence) < CONFIDENCES.indexOf(same.confidence)) same.confidence = confidence
        continue
      }
      findings.push({ title: String(f.title ?? 'untitled'), lenses: [lens], evidence, severity, confidence, recommendation: f.recommendation ? String(f.recommendation) : null, alternatives: Array.isArray(f.alternatives) ? f.alternatives.map(String) : [] })
    }
    for (const s of a?.strengths ?? []) strengths.push({ lens, strength: typeof s === 'string' ? s : String(s?.text ?? s?.strength ?? '') })
  }
  for (const f of findings) if (!f.recommendation) problems.push(`"${f.title}" has no recommendation`)
  findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || CONFIDENCES.indexOf(a.confidence) - CONFIDENCES.indexOf(b.confidence))
  return { findings, questions, strengths, problems }
}
