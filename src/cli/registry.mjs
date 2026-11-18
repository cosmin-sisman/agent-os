// The command registry: every agent-os command with its summary, its lifecycle state and, when it is
// implemented, a lazy loader for its module in src/commands/. Planned commands name the issue that builds them.

/**
 * @typedef {object} CommandEntry
 * @property {string} name
 * @property {string} summary one line, shown by --help
 * @property {'planned' | 'new' | 'stable' | 'deprecated'} status lifecycle (design §19)
 * @property {number} [issue] the issue that implements or tracks it
 * @property {() => Promise<CommandModule>} [load] present once the command is implemented
 */

/**
 * @typedef {object} CommandModule
 * @property {Record<string, import('node:util').ParseArgsOptionDescriptor & { description?: string }>} [options]
 * @property {string} [usage]
 * @property {(ctx: import('./context.mjs').Context) => Promise<number | void> | number | void} run
 */

/** @type {CommandEntry[]} */
export const COMMANDS = [
  { name: 'help', summary: 'Show help for agent-os or for one command', status: 'new', issue: 3, load: () => import('../commands/help.mjs') },
  { name: 'version', summary: 'Print the agent-os version', status: 'new', issue: 3, load: () => import('../commands/version.mjs') },
  { name: 'init', summary: 'Detect the repository, ask a few questions and install agent-os', status: 'planned', issue: 49 },
  { name: 'config', summary: 'Read or change agent-os.json and your personal settings', status: 'planned', issue: 4 },
  { name: 'doctor', summary: 'Check the agent system and platform hygiene', status: 'planned', issue: 27 },
  { name: 'env', summary: 'Check MCP servers, CLIs, token scopes and variables', status: 'planned', issue: 9 },
  { name: 'update', summary: 'Plan and apply an agent-os upgrade as a pull or merge request', status: 'planned', issue: 68 },
  { name: 'eject', summary: 'Stop managing a file and hand it to the project', status: 'planned', issue: 6 },
  { name: 'platform', summary: 'Detect, probe or switch the code platform (GitHub, GitLab)', status: 'planned', issue: 90 },
  { name: 'lang', summary: 'Show or change the language of an area', status: 'planned', issue: 7 },
  { name: 'next', summary: 'Recommend what to work on next, with reasons', status: 'planned', issue: 18 },
  { name: 'overlap', summary: 'List open changes that touch the same files as yours', status: 'planned', issue: 33 },
  { name: 'gate', summary: 'Run the checks the current diff needs', status: 'planned', issue: 43 },
  { name: 'check', summary: 'Check a pull or merge request title or a commit message', status: 'planned', issue: 19 },
  { name: 'map', summary: 'Render a map of one area of the code, on demand', status: 'planned', issue: 26 },
  { name: 'journal', summary: 'Add to or read the project journal', status: 'planned', issue: 22 },
  { name: 'lessons', summary: 'Capture, recall, search and triage lessons learned', status: 'planned', issue: 24 },
  { name: 'decision', summary: 'Create a decision record', status: 'planned', issue: 23 },
  { name: 'chronicle', summary: 'One timeline from git, the platform and the journal', status: 'planned', issue: 25 },
  { name: 'stack', summary: 'Show, change, detect or import the stack map', status: 'planned', issue: 74 },
  { name: 'system', summary: 'Map components, interfaces, exposure and contracts', status: 'planned', issue: 113 },
  { name: 'artifact', summary: 'Create, build, verify and link artifacts', status: 'planned', issue: 82 },
  { name: 'skill', summary: 'Add, remove, update or list core, external and local skills', status: 'planned', issue: 39 },
  { name: 'retrofit', summary: 'Plan and apply history into the system for an existing repository', status: 'planned', issue: 50 },
  { name: 'sbom', summary: 'Generate a software bill of materials for the security watch', status: 'planned', issue: 108 },
]

/** @param {string} name */
export const findCommand = (name) => COMMANDS.find((c) => c.name === name)

/** The registered command closest to `name`, when it is close enough to be a likely typo. */
export function suggestCommand(name) {
  let best
  for (const c of COMMANDS) {
    const d = distance(name, c.name)
    if (d <= Math.max(1, Math.floor(c.name.length / 3)) && (!best || d < best.d)) best = { name: c.name, d }
  }
  return best?.name
}

/** Levenshtein distance; inputs are short command names. */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]
}
