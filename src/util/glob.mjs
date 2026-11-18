// Path globs for gate mappings and lesson cards: "**" any number of segments, "*" anything inside one segment, "?" one
// character, "{a,b}" alternatives. Paths use "/" on every OS.

const cache = new Map()

/** A RegExp for a glob. */
export function globToRegExp(glob) {
  if (cache.has(glob)) return cache.get(glob)
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/'
      re += slash ? '(?:.*/)?' : '.*'
      i += slash ? 2 : 1
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else if (c === '{') {
      const end = glob.indexOf('}', i)
      if (end === -1) { re += '\\{'; continue }
      re += `(?:${glob.slice(i + 1, end).split(',').map((p) => p.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`
      i = end
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  const out = new RegExp(`^${re}$`)
  cache.set(glob, out)
  return out
}

/** True when a path matches a glob. A glob ending in "/" matches everything below it. */
export const matches = (path, glob) => globToRegExp(glob.endsWith('/') ? `${glob}**` : glob).test(String(path).replace(/\\/g, '/'))
