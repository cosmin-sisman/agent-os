// Repository state detection: the signals init reads (commits, code, docs and specs, tags, the last commit, CI,
// existing agent files, and open change requests when the platform answers) and the profile they suggest, with a
// confidence and a one-line reason. It works offline with git alone. Design §11.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const PROFILES = ['greenfield', 'spec-first', 'active', 'maintenance']
const CODE = /\.(js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|cs|php|swift|c|cc|cpp|h|scala|ex|exs|vue|svelte|sql|sh)$/i
const SKIP = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', '.venv', 'target', '.next', 'coverage'])

function files(cwd) {
  const out = []
  const walk = (dir, depth) => {
    if (depth > 6 || out.length > 5000) return
    let entries
    try { entries = readdirSync(join(cwd, dir), { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue
      const rel = dir ? `${dir}/${e.name}` : e.name
      if (e.isDirectory()) walk(rel, depth + 1)
      else out.push(rel)
    }
  }
  walk('', 0)
  return out
}

const out = (r) => (r.status === 0 ? r.stdout.trim() : '')
const DAY = 86400e3

/**
 * The signals of a repository.
 * @param {{ cwd: string, git: Function, tracker?: object, now?: Date }} deps
 */
export function signals({ cwd, git, tracker, now = new Date() }) {
  const all = files(cwd)
  const commits = Number(out(git(['rev-list', '--count', 'HEAD']))) || 0
  const last = out(git(['log', '-1', '--format=%cI']))
  const tags = out(git(['tag', '--list'])).split(/\r?\n/).filter(Boolean)
  const recent = Number(out(git(['rev-list', '--count', `--since=${new Date(now.getTime() - 90 * DAY).toISOString()}`, 'HEAD']))) || 0
  const code = all.filter((f) => CODE.test(f) && !/(^|\/)(docs?|specs?)\//i.test(f))
  const docs = all.filter((f) => /^(docs?|specs?|rfcs?|design)\//i.test(f) || (/\.(md|adoc|rst)$/i.test(f) && !/^(README|CHANGELOG|LICENSE|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY)\b/i.test(f.split('/').pop())))
  const ci = ['.github/workflows', '.gitlab-ci.yml', '.circleci', 'azure-pipelines.yml', 'Jenkinsfile'].filter((p) => existsSync(join(cwd, p)))
  const agentFiles = ['CLAUDE.md', 'AGENTS.md', '.claude', '.cursorrules', '.cursor', '.github/copilot-instructions.md', 'agent-os.json'].filter((p) => existsSync(join(cwd, p)))
  let openChangeRequests = null
  if (tracker) { try { openChangeRequests = tracker.openPullRequests().length } catch { openChangeRequests = null } }
  return {
    commits, recentCommits: recent, lastCommit: last || null, daysSinceLastCommit: last ? Math.floor((now - new Date(last)) / DAY) : null,
    tags: tags.length, codeFiles: code.length, docFiles: docs.length, ci, agentFiles, openChangeRequests,
  }
}

/** The profile the signals suggest, with a confidence and the reason in one line. */
export function suggestProfile(s) {
  const pick = (profile, confidence, reason) => ({ profile, confidence, reason })
  if (s.commits < 5 && s.codeFiles === 0 && s.docFiles < 3) return pick('greenfield', s.commits === 0 ? 'high' : 'medium', `${s.commits} commit(s) and no code: a new project`)
  if (s.codeFiles < 5 && s.docFiles >= 3) return pick('spec-first', s.codeFiles === 0 ? 'high' : 'medium', `${s.docFiles} documents and ${s.codeFiles} code file(s): the specs come first`)
  if (s.tags > 0 && s.daysSinceLastCommit !== null && s.daysSinceLastCommit >= 180) return pick('maintenance', 'high', `${s.tags} tag(s) and no commit for ${s.daysSinceLastCommit} days: a finished project in maintenance`)
  if (s.recentCommits >= 10 || (s.openChangeRequests ?? 0) > 0) return pick('active', s.recentCommits >= 10 && (s.openChangeRequests ?? 0) > 0 ? 'high' : 'medium', `${s.recentCommits} commit(s) in 90 days${s.openChangeRequests ? ` and ${s.openChangeRequests} open change request(s)` : ''}: in active development`)
  if (s.tags > 0 && s.recentCommits < 10) return pick('maintenance', 'medium', `${s.tags} tag(s) and only ${s.recentCommits} commit(s) in 90 days: mostly maintenance`)
  if (s.codeFiles === 0 && s.commits < 5) return pick('greenfield', 'medium', `${s.commits} commit(s), no code yet`)
  return pick('active', 'low', `${s.commits} commit(s) and ${s.codeFiles} code file(s), with little recent activity: treated as active; confirm or choose another profile`)
}

/** Signals and suggestion together, as init shows them. */
export const detectState = (deps) => { const s = signals(deps); return { signals: s, ...suggestProfile(s) } }
