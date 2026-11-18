// Test helper: a fake machine for env checks (files by name, commands by "cmd args", variable names that are set).

import { existsSync, readFileSync } from 'node:fs'

/** Without `files`, files are read from disk (command tests write real repositories). */
export function fakeProbe({ files, commands = {}, env = [] } = {}) {
  const calls = []
  return {
    calls,
    read: (path) => (files ? files[path.split(/[\\/]/).pop()] ?? null : existsSync(path) ? readFileSync(path, 'utf8') : null),
    hasEnv: (name) => env.includes(name),
    run(cmd, args) {
      calls.push([cmd, ...args].join(' '))
      const r = commands[[cmd, ...args].join(' ')] ?? commands[cmd]
      return r ? { found: true, status: 0, stdout: '', stderr: '', ...r } : { found: false, status: null, stdout: '', stderr: '' }
    },
  }
}
