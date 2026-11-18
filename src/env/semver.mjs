// Version checks for `requires.cli`: extract a version from a tool's output and test it against a range
// (`*`, `1.2.3`, `>=2.60`, `^1.2`, `~1.2.3`, or several comparators separated by spaces).

/** The first x.y[.z] version in a text, as [major, minor, patch], or null. */
export function extractVersion(text) {
  const m = String(text).match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null
}

const parse = (v) => {
  const [a = 0, b = 0, c = 0] = v.split('.').map((x) => Number(x))
  return [a, b, c]
}
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/**
 * True when `version` satisfies every comparator in `range`.
 * @param {number[]} version from extractVersion
 * @param {string} range
 */
export function satisfies(version, range) {
  const r = range.trim()
  if (r === '' || r === '*' || r === 'x') return true
  return r.split(/\s+/).every((part) => {
    const m = part.match(/^(>=|<=|>|<|=|\^|~)?v?(\d+(?:\.\d+){0,2})$/)
    if (!m) throw new Error(`invalid version range "${range}"`)
    const [op = '=', raw] = [m[1], m[2]]
    const target = parse(raw)
    const parts = raw.split('.').length
    const c = cmp(version, target)
    switch (op) {
      case '>=': return c >= 0
      case '<=': return c <= 0
      case '>': return c > 0
      case '<': return c < 0
      case '^': return c >= 0 && (target[0] > 0 ? version[0] === target[0] : version[1] === target[1])
      case '~': return c >= 0 && version[0] === target[0] && (parts < 2 || version[1] === target[1])
      default: return parts === 3 ? c === 0 : version.slice(0, parts).every((x, i) => x === target[i])
    }
  })
}
