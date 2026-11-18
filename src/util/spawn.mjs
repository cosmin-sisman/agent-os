// Limits and failures for the child processes agent-os starts (gh, glab, git). A platform answer can be several MB
// (100 pull requests with their bodies), past Node's 1 MB default, so output gets a larger buffer; a process that is
// cut off or times out becomes a short, clear error, never the output it produced (#265).

/** Room for large answers; a whole page of change requests with bodies fits many times over. */
export const MAX_OUTPUT = 256 * 1024 * 1024

/** Error text is at most this long: a message is read by a person, never a dump of a response. */
export const MAX_ERROR = 300

/** The first line of a tool's output, capped to MAX_ERROR characters. */
export function excerpt(text, max = MAX_ERROR) {
  const line = String(text ?? '').trim().split('\n')[0]
  return line.length > max ? `${line.slice(0, max - 1)}… (${line.length} characters)` : line
}

/** Why a spawn did not finish, from spawnSync's error, or null when it ran to the end. */
export function spawnProblem(r, tool) {
  const code = r.error?.code
  if (!code) return null
  if (code === 'ENOBUFS') return `${tool}'s output was larger than ${MAX_OUTPUT / 1024 / 1024} MB and was cut off`
  if (code === 'ETIMEDOUT' || r.signal === 'SIGTERM') return `${tool} did not answer in time`
  return `${tool} could not run (${code})`
}
