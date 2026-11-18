// Whether a command is on the PATH, without running it: each PATH folder is checked for the file (with the Windows
// extensions from PATHEXT). Used to tell an agent how to reach the agent-os CLI when it is not installed (#275).

import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/** True when `name` is an executable file in one of the PATH folders. */
export function onPath(name, env = process.env, platform = process.platform) {
  const exts = platform === 'win32' ? String(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : ['']
  const dirs = String(env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean)
  return dirs.some((d) => exts.some((e) => existsSync(join(d, `${name}${e.toLowerCase()}`)) || (e && existsSync(join(d, `${name}${e}`)))))
}
