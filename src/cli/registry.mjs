// The command registry: every agent-os command with its summary, its lifecycle state and, when it is
// implemented, a lazy loader for its module in src/commands/. Planned commands name the issue that builds them.

import { closest } from '../util/closest.mjs'

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
  { name: 'init', summary: 'Set up agent-os; --me sets only your personal settings (full init: #49)', status: 'new', issue: 99, load: () => import('../commands/init.mjs') },
  { name: 'config', summary: 'Read, change or validate agent-os.json and your personal settings', status: 'new', issue: 4, load: () => import('../commands/config.mjs') },
  { name: 'doctor', summary: 'Check the agent system, the repository and platform hygiene; readiness score; --fix', status: 'new', issue: 27, load: () => import('../commands/doctor.mjs') },
  { name: 'env', summary: 'Check MCP servers, CLIs, token scopes and variables, on this laptop and in the repo', status: 'new', issue: 9, load: () => import('../commands/env.mjs') },
  { name: 'update', summary: 'Plan and run an upgrade of agent-os, on its own branch, as a change request', status: 'new', issue: 68, load: () => import('../commands/update.mjs') },
  { name: 'eject', summary: 'Stop managing a file, block or hooks entry; the content stays as it is', status: 'new', issue: 6, load: () => import('../commands/eject.mjs') },
  { name: 'hook', summary: 'Run the Claude Code hook handlers for an event (called from .claude/settings.json)', status: 'new', issue: 8, load: () => import('../commands/hook.mjs') },
  { name: 'platform', summary: 'Show the code platform and its login, or detect it from the git remote (GitHub, GitLab)', status: 'new', issue: 90, load: () => import('../commands/platform.mjs') },
  { name: 'lang', summary: 'Show or set the language of each area (renaming labels and milestones), check ro text, print the language rule', status: 'new', issue: 7, load: () => import('../commands/lang.mjs') },
  { name: 'issue', summary: 'Create, relate, assign, branch and place issues on the board; read progress', status: 'new', issue: 12, load: () => import('../commands/issue.mjs') },
  { name: 'setup', summary: 'Make the repository ready on its platform: branches, protection, labels, milestones, files', status: 'new', issue: 11, load: () => import('../commands/setup.mjs') },
  { name: 'manifest', summary: 'Build and check the lifecycle manifest; list deprecated items this project still uses', status: 'new', issue: 66, load: () => import('../commands/manifest.mjs') },
  { name: 'start', summary: 'Claim an issue: assign, branch from the right base, link, In Progress, check out', status: 'new', issue: 14, load: () => import('../commands/start.mjs') },
  { name: 'next', summary: 'Recommend what to work on next, with reasons', status: 'new', issue: 18, load: () => import('../commands/next.mjs') },
  { name: 'board', summary: 'Keep the optional planning board in step with the issues (GitHub Projects)', status: 'new', issue: 20, load: () => import('../commands/board.mjs') },
  { name: 'overlap', summary: 'List open changes that touch the same files as yours', status: 'new', issue: 33, load: () => import('../commands/overlap.mjs') },
  { name: 'test', summary: 'Plan scenarios into issues, write results into change requests, run suites, find test gaps', status: 'new', issue: 44, load: () => import('../commands/test.mjs') },
  { name: 'gate', summary: 'Run the checks the current diff needs', status: 'new', issue: 43, load: () => import('../commands/gate.mjs') },
  { name: 'pr', summary: 'Open the change request when it is ready; its checks and review threads', status: 'new', issue: 15, load: () => import('../commands/pr.mjs') },
  { name: 'ship', summary: 'Merge a green, reviewed change request; close or comment on its issues; clean up the branch', status: 'new', issue: 16, load: () => import('../commands/ship.mjs') },
  { name: 'release', summary: 'Plan, open and finish a release (merge commit, tag, notes, milestone roll, sync back); release notes', status: 'new', issue: 17, load: () => import('../commands/release.mjs') },
  { name: 'check', summary: 'Check a pull or merge request title against its description, or a commit message', status: 'new', issue: 19, load: () => import('../commands/check.mjs') },
  { name: 'map', summary: 'Render a map of one area of the code, on demand', status: 'planned', issue: 26 },
  { name: 'journal', summary: 'Add to or read the project journal', status: 'new', issue: 22, load: () => import('../commands/journal.mjs') },
  { name: 'lessons', summary: 'Capture, recall, search and triage lessons learned', status: 'new', issue: 24, load: () => import('../commands/lessons.mjs') },
  { name: 'retro', summary: 'Triage the lessons inbox and repeated review findings; keep the Retro issue up to date', status: 'new', issue: 29, load: () => import('../commands/retro.mjs') },
  { name: 'decision', summary: 'Create, list and check decision records with date-based ids', status: 'new', issue: 23, load: () => import('../commands/decision.mjs') },
  { name: 'chronicle', summary: 'One timeline from the platform and the journal, rendered into the cache', status: 'new', issue: 25, load: () => import('../commands/chronicle.mjs') },
  { name: 'stack', summary: 'Show, change, detect or import the stack map', status: 'planned', issue: 74 },
  { name: 'system', summary: 'Map components, interfaces, exposure and contracts', status: 'planned', issue: 113 },
  { name: 'artifact', summary: 'Create, build, verify and link artifacts', status: 'planned', issue: 82 },
  { name: 'skills', summary: 'The skill index: core, external and local skills, with what each does', status: 'new', issue: 41, load: () => import('../commands/skills.mjs') },
  { name: 'skill', summary: 'Register skills and check the registry (add, update and remove vendored skills: #39)', status: 'new', issue: 38, load: () => import('../commands/skill.mjs') },
  { name: 'retrofit', summary: 'Plan and apply history into the system for an existing repository', status: 'planned', issue: 50 },
  { name: 'sbom', summary: 'Generate a software bill of materials for the security watch', status: 'planned', issue: 108 },
]

/** @param {string} name */
export const findCommand = (name) => COMMANDS.find((c) => c.name === name)

/** The registered command closest to `name`, when it is close enough to be a likely typo. */
export const suggestCommand = (name) => closest(name, COMMANDS.map((c) => c.name))
