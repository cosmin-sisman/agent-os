// Reporting vulnerabilities safely (design §23, "Reporting safely"). A real vulnerability is never a public issue: it
// goes to the platform's private channel (a draft security advisory on GitHub, a confidential issue on GitLab),
// through the adapter's reportVulnerability. Hardening work that reveals nothing exploitable is a normal issue with
// the security label. Every issue that agent-os files passes through `vulnerabilityIn` first, so no path files one
// publicly by mistake.

import { CliError } from '../cli/errors.mjs'

/** Words that say a text describes an exploitable weakness, not hardening. */
const SIGNS = [
  [/\b(sql|command|code|ldap|header|template|nosql)[- ]?injection\b|\binjection (bug|flaw|vulnerability)\b/i, 'injection'],
  [/\bxss\b|cross[- ]site scripting/i, 'cross-site scripting'],
  [/\brce\b|remote code execution/i, 'remote code execution'],
  [/\bssrf\b|server[- ]side request forgery/i, 'server-side request forgery'],
  [/\bcsrf\b|cross[- ]site request forgery/i, 'cross-site request forgery'],
  [/\b(auth(entication|orization)?|login|access control) bypass\b|\bbypass(es|ing)? (the )?(auth|login|authorization)\b/i, 'authorization bypass'],
  [/\bprivilege escalation\b|\bescalate privileges\b/i, 'privilege escalation'],
  [/\bidor\b|insecure direct object reference/i, 'insecure direct object reference'],
  [/\b(path|directory) traversal\b/i, 'path traversal'],
  [/\b(leaked|exposed|committed) ([\w-]+ )?(secret|key|token|credential|password)s?\b/i, 'leaked secret'],
  [/\bexploitable\b|\bvulnerab(le|ility) in (our|this|the) (code|app|api|service)\b/i, 'exploitable'],
]

/** What makes an issue's text a vulnerability, or null when it reads as ordinary work. */
export function vulnerabilityIn({ title = '', body = '' } = {}) {
  const text = `${title}\n${body}`
  const hit = SIGNS.find(([re]) => re.test(text))
  return hit ? hit[1] : null
}

/**
 * Refuses to file a vulnerability as a normal issue. `hardening: true` is the person saying it reveals nothing
 * exploitable (then it is filed with the security label instead).
 */
export function assertNotPublicVulnerability(spec, { hardening = false } = {}) {
  if (hardening) return
  const why = vulnerabilityIn(spec)
  if (why) {
    throw new CliError(`this reads as a vulnerability (${why}): it is never filed as a public issue`, {
      hint: 'report it privately with agent-os security report --title "…" --body-file <f>, or, if it reveals nothing exploitable, file it as hardening with --hardening',
    })
  }
}

const SEVERITIES = ['low', 'medium', 'high', 'critical']

/** The private report: what the adapter sends, from the person's title, body and optional severity and package. */
export function reportSpec({ title, body, severity, pkg }) {
  if (!title?.trim()) throw new CliError('a report needs a title', { hint: 'agent-os security report --title "SQL injection in the search endpoint" --body-file report.md' })
  if (severity && !SEVERITIES.includes(severity)) throw new CliError(`--severity must be one of ${SEVERITIES.join(', ')}`)
  return { title: title.trim(), body: String(body ?? '').trim(), severity: severity ?? null, pkg: pkg ?? null }
}
