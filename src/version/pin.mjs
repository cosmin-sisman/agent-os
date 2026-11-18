// The pinned agent-os version: every teammate and every hook runs the exact version the project chose, never whatever
// an npx cache happens to hold. Design §19.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const PACKAGE = '@cosmin-sisman/agent-os'
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

/** The version of the agent-os code that is running now. */
export const runningVersion = () => JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version

const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null } }

/** How the project installs agent-os: its devDependency spec and the version actually in node_modules, if any. */
export function projectInstall(cwd) {
  const pkg = readJson(join(cwd, 'package.json'))
  const spec = pkg?.devDependencies?.[PACKAGE] ?? pkg?.dependencies?.[PACKAGE] ?? null
  const installed = existsSync(join(cwd, 'node_modules', PACKAGE, 'package.json')) ? readJson(join(cwd, 'node_modules', PACKAGE, 'package.json'))?.version ?? null : null
  return { spec, installed }
}

/** The pinned version: agent-os.json → version, or the running version when the project has not pinned one yet. */
export const pinnedVersion = (config) => config.version ?? runningVersion()

/**
 * The command hooks use to call agent-os. With a devDependency, the project's own install (pinned by its lockfile);
 * otherwise npx with the exact version. Never a bare, unpinned `npx agent-os`.
 */
export function hookCommand(config, { cwd } = {}) {
  // agent-os's own repository runs its own executable: the code being developed, and no network (#61).
  if (cwd && readJson(join(cwd, 'package.json'))?.name === PACKAGE && existsSync(join(cwd, 'bin/agent-os.mjs'))) return 'node bin/agent-os.mjs'
  const { spec } = cwd ? projectInstall(cwd) : { spec: null }
  // An exact version, or a tarball vendored into the repository (air-gapped installs): the project's own copy, which
  // never touches the network.
  if (spec && (EXACT.test(spec) || /^file:.+\.t(ar\.)?gz$/.test(spec))) return 'npx --no-install agent-os'
  const registry = config.npmRegistry ? ` --registry ${config.npmRegistry}` : ''
  return `npx -y${registry} ${PACKAGE}@${pinnedVersion(config)}`
}

/**
 * Compares the pin with what runs and with what is installed.
 * @returns {{ ok: boolean, pinned: string | null, running: string, installed: string | null, problems: { message: string, fix: string }[] }}
 */
export function versionStatus(config, { cwd, running = runningVersion() } = {}) {
  const pinned = config.version ?? null
  const { spec, installed } = projectInstall(cwd)
  const problems = []
  if (!pinned) problems.push({ message: `agent-os.json does not pin a version (running ${running})`, fix: `agent-os config set version ${running}` })
  if (pinned && running !== pinned) {
    problems.push({ message: `agent-os ${running} is running, the project pins ${pinned}`, fix: spec ? `npm install -D ${PACKAGE}@${pinned}` : `run agent-os as npx -y ${PACKAGE}@${pinned} (the hooks already do)` })
  }
  if (spec && !EXACT.test(spec)) problems.push({ message: `package.json allows a range for agent-os ("${spec}"), so teammates can get different versions`, fix: `npm install -D -E ${PACKAGE}@${pinned ?? running}` })
  if (spec && pinned && EXACT.test(spec) && spec !== pinned) problems.push({ message: `package.json installs agent-os ${spec}, agent-os.json pins ${pinned}`, fix: `npm install -D -E ${PACKAGE}@${pinned}` })
  if (installed && pinned && installed !== pinned) problems.push({ message: `node_modules holds agent-os ${installed}, the project pins ${pinned}`, fix: 'npm ci' })
  return { ok: problems.length === 0, pinned, running, installed, problems }
}
