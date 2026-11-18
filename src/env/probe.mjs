// How env checks look at the machine: run a command, read a file, read an environment variable. Checks receive a
// probe instead of calling the system directly, so tests can replace it and nothing secret is passed around.

import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

/**
 * @typedef {object} Probe
 * @property {(cmd: string, args: string[], options?: { timeoutMs?: number }) => { found: boolean, status: number | null, stdout: string, stderr: string }} run
 * @property {(path: string) => string | null} read
 * @property {(name: string) => boolean} hasEnv only whether a variable is set; its value is never read by checks
 */

/** The real machine. Commands run without a shell, with a timeout; Windows .cmd shims are tried after the bare name. */
export function systemProbe(env = process.env) {
  return {
    run(cmd, args, { timeoutMs = 8000 } = {}) {
      const names = process.platform === 'win32' ? [cmd, `${cmd}.cmd`, `${cmd}.exe`] : [cmd]
      for (const name of names) {
        const r = spawnSync(name, args, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, shell: false })
        if (r.error?.code === 'ENOENT') continue
        return { found: true, status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
      }
      return { found: false, status: null, stdout: '', stderr: '' }
    },
    read: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null),
    hasEnv: (name) => typeof env[name] === 'string' && env[name] !== '',
  }
}
