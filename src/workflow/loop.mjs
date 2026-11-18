// The loop check (`agent-os/loop`): the self-improvement loop has no exceptions, so it is enforced in CI, not by local
// hooks. A change request passes when doctor --ci has no failure, its Lessons section says something, and the lesson
// or decision it claims is recorded in a journal entry on the branch. Design §10 (Verify).

import { runDoctor } from '../doctor/doctor.mjs'
import { SECTIONS, section } from './pr.mjs'

/** The name the check reports under, and the one platform setup makes required. */
export const LOOP_CHECK = 'agent-os/loop'

/** Dependency bots: their change requests are covered by the release entry instead. */
export const isBot = (login) => /\[bot\]$|^(dependabot|renovate|github-actions)(\[bot\])?$/i.test(String(login ?? ''))

/**
 * @param {{ config: object, git: Function, cwd: string, running: string }} deps
 * @param {{ body: string, base?: string, author?: string, lang?: string }} input
 * @returns {{ ok: boolean, exempt?: string, problems: string[], notes: string[] }}
 */
export function checkLoop({ config, git, cwd, running }, { body, base = config.branches.integration, author, lang = 'en' }) {
  if (isBot(author)) return { ok: true, exempt: `${author} is a dependency bot: the release entry records its changes`, problems: [], notes: [] }
  const problems = []
  const notes = []
  const heading = (SECTIONS[lang] ?? SECTIONS.en).lessons
  const lessons = section(body ?? '', heading) ?? (lang !== 'en' ? section(body ?? '', SECTIONS.en.lessons) : null)
  if (lessons === null) problems.push(`the description has no "## ${heading}" section: add it with the lesson, or "None: <why>"`)
  else if (!lessons) problems.push(`"## ${heading}" is empty (a template comment does not count): write the lesson, or "None: <why>"`)
  else if (/^(none|niciuna?)\.?$/i.test(lessons)) problems.push(`"## ${heading}" says none without a reason: write "None: <why>"`)
  const trivial = Boolean(lessons && /^(none|niciuna?)\s*:\s*\S/i.test(lessons))
  const added = git(['diff', '--name-only', '--diff-filter=A', `origin/${base}...HEAD`])
  if (added.status !== 0) problems.push(`cannot compare with origin/${base}: check out with the full history (fetch-depth: 0)`)
  else {
    const entries = added.stdout.split(/\r?\n/).filter((f) => /^\.agent-os\/journal\/.+\.md$/.test(f))
    if (entries.length) notes.push(`journal: ${entries.join(', ')}`)
    else if (!trivial) problems.push('the change request records a lesson or decision but adds no journal entry: agent-os journal add … (or say "None: <why>" for a trivial change)')
    else notes.push('no journal entry: the Lessons section marks the change as trivial')
  }
  const d = runDoctor({ cwd, config, running }, { ci: true })
  for (const c of d.checks) for (const f of c.findings.filter((x) => x.level === 'fail')) problems.push(`doctor [${c.id}]: ${f.message} (fix: ${f.fix})`)
  notes.push(`doctor --ci: readiness ${d.score}/100`)
  return { ok: problems.length === 0, problems, notes }
}
