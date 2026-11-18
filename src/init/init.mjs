// The full init: confirm the profile, ask a few questions (or take flags), show the plan (configuration, files,
// platform), then write and check. Nothing is written in a dry run, and the platform is changed only when asked
// (`--setup`), because it changes settings other people rely on. Design §11.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { GITIGNORE_ENTRIES, LOCAL_FILE, TEAM_FILE, saveJson, validate, loadConfig } from '../config/config.mjs'
import { AREAS } from '../i18n/i18n.mjs'
import { installRoutes } from '../managed/install.mjs'
import { runDoctor } from '../doctor/doctor.mjs'
import { addEntry } from '../journal/journal.mjs'
import { SLOT_DEFAULTS } from '../registry/slots.mjs'

export const TEAM_IGNORES = [...GITIGNORE_ENTRIES, '.claude/settings.local.json', '.claude/worktrees/']
const DAY = 86400e3

/** Gate suites suggested from package.json scripts (the team edits them later). */
export function suggestGate(cwd) {
  try {
    const scripts = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).scripts ?? {}
    return Object.fromEntries(['test', 'lint', 'typecheck', 'build'].filter((s) => scripts[s] && !/no test specified/.test(scripts[s])).map((s) => [s, `npm run ${s}`]))
  } catch { return {} }
}

/**
 * The team and personal configuration from the answers.
 * @param {{ profile: string, platform: object, integration: string, production: string, team: boolean, lang: string, areaLangs: Record<string,string>, chat: string, version: string, now?: Date, cwd: string }} a
 */
export function buildConfig(a) {
  const now = a.now ?? new Date()
  const languages = Object.fromEntries(AREAS.filter((x) => !x.personal).map((x) => [x.id, a.areaLangs[x.id] ?? a.lang]))
  const team = {
    version: a.version,
    platform: a.platform,
    branches: { integration: a.integration, production: a.production, requiredApprovals: a.team ? 1 : 0 },
    languages,
    gate: suggestGate(a.cwd),
    // Every slot written out, bound or explicitly empty, so the choice is visible and swapping is one line (#40).
    slots: { ...SLOT_DEFAULTS },
    adoption: { warnOnlyUntil: new Date(now.getTime() + 14 * DAY).toISOString().slice(0, 10), ...(a.methodology === 'forward-only' ? { cutoff: now.toISOString().slice(0, 10) } : {}) },
  }
  const local = { languages: { chat: a.chat } }
  return { team, local }
}

/**
 * An existing agent-os.json completed with init's answers: the team's own keys stay (ci, gate, packs…), and each
 * answered section is merged into the one already there, so init never drops what the team set (#61).
 */
export function completeTeam(existing, team) {
  const out = { ...(existing ?? {}) }
  for (const [k, v] of Object.entries(team)) {
    const cur = out[k]
    out[k] = v && cur && typeof v === 'object' && typeof cur === 'object' && !Array.isArray(v) && !Array.isArray(cur) ? { ...cur, ...v } : v
  }
  return out
}

/** What init would do, without doing it. */
export function planInit({ cwd, team: answers, local, version }) {
  const team = completeTeam(loadConfig(cwd).team, answers)
  const problems = [...validate(team, { personal: false, file: TEAM_FILE }), ...validate(local, { personal: true, file: LOCAL_FILE })]
  const existing = existsSync(join(cwd, TEAM_FILE))
  const base = completeTeam(loadConfig(cwd).merged, team)
  const merged = { ...base, languages: { ...base.languages, ...local.languages } }
  const files = problems.length ? [] : installRoutes(cwd, merged, { version, dryRun: true }).results
  const ignore = (() => { const text = existsSync(join(cwd, '.gitignore')) ? readFileSync(join(cwd, '.gitignore'), 'utf8') : ''; const lines = text.split(/\r?\n/).map((l) => l.trim()); return TEAM_IGNORES.filter((e) => !lines.includes(e)) })()
  return { problems, existing, files, ignore, merged }
}

/** Writes the plan: configuration, .gitignore, managed files; then runs doctor (offline). */
export function applyInit({ cwd, team: answers, local, version, plan, baseline = null }) {
  const team = completeTeam(loadConfig(cwd).team, answers)
  saveJson(cwd, TEAM_FILE, team)
  saveJson(cwd, LOCAL_FILE, local)
  if (plan.ignore.length) {
    const file = join(cwd, '.gitignore')
    const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
    writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${plan.ignore.join('\n')}\n`)
  }
  const { merged } = loadConfig(cwd)
  const results = installRoutes(cwd, merged, { version }).results
  if (baseline) addEntry(cwd, baselineEntry(team, baseline))
  const doctor = runDoctor({ cwd, config: merged, running: version }, { offline: true })
  return { results, doctor }
}

/**
 * The baseline entry of a forward-only adoption: a snapshot of where the repository stood, so later readers know
 * which history predates the conventions.
 * @param {object} team the team configuration (with adoption.cutoff)
 * @param {{ signals: object, profile: string, author: string, now?: Date, openIssues?: number | null }} b
 */
export function baselineEntry(team, { signals: s, profile, author, now = new Date(), openIssues = null }) {
  return {
    type: 'note', title: `Baseline: agent-os adopted forward-only on ${team.adoption.cutoff}`, areas: ['adoption'], refs: [], author, at: now,
    body: [
      `From ${team.adoption.cutoff} on, the conventions apply to new work; history before it stays as it is, and \`agent-os doctor\` does not report it.`,
      '',
      `- Profile: ${profile}`,
      `- Commits: ${s.commits} (${s.recentCommits} in the last 90 days), last on ${s.lastCommit ?? 'never'}; tags: ${s.tags}`,
      `- Code files: ${s.codeFiles}; documents: ${s.docFiles}; CI: ${s.ci.join(', ') || 'none'}; agent files: ${s.agentFiles.join(', ') || 'none'}`,
      ...(s.openChangeRequests === null ? [] : [`- Open change requests: ${s.openChangeRequests}`]),
      ...(openIssues === null ? [] : [`- Open issues: ${openIssues}`]),
    ].join('\n'),
  }
}
