// Line-based three-way merge (diff3): combines the changes from base→ours and base→theirs. Changes to different
// lines are both kept; the same change on both sides is kept once; different changes to the same lines conflict.

/** Splits text into lines; the last element is '' when the text ends with a newline. */
const lines = (text) => text.replace(/\r\n/g, '\n').split('\n')

/** For each line of `a`, the index of its matching line in `b` (longest common subsequence), or -1. */
function lcsMap(a, b) {
  const n = a.length
  const m = b.length
  const w = m + 1
  const dp = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
    }
  }
  const map = new Int32Array(n).fill(-1)
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { map[i] = j; i++; j++ } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++
    else j++
  }
  return map
}

const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i])

/**
 * Merges two descendants of `base`.
 * @param {string} base the version both sides started from
 * @param {string} ours the local version (edited by the team)
 * @param {string} theirs the new version agent-os brings
 * @param {{ oursLabel?: string, theirsLabel?: string }} [labels] used in conflict markers
 * @returns {{ text: string, conflicts: number }} text has conflict markers when conflicts > 0
 */
export function merge3(base, ours, theirs, { oursLabel = 'local', theirsLabel = 'agent-os' } = {}) {
  const B = lines(base)
  const O = lines(ours)
  const T = lines(theirs)
  const mo = lcsMap(B, O)
  const mt = lcsMap(B, T)
  const out = []
  let conflicts = 0
  let b = 0
  let o = 0
  let t = 0
  for (;;) {
    // Next base line that both sides kept, at or after the current positions: the end of an unstable chunk.
    let k = b
    while (k < B.length && !(mo[k] >= o && mt[k] >= t)) k++
    const bc = B.slice(b, k)
    const oc = O.slice(o, k < B.length ? mo[k] : O.length)
    const tc = T.slice(t, k < B.length ? mt[k] : T.length)
    if (same(oc, bc)) out.push(...tc)
    else if (same(tc, bc) || same(oc, tc)) out.push(...oc)
    else {
      conflicts++
      out.push(`<<<<<<< ${oursLabel}`, ...oc, '=======', ...tc, `>>>>>>> ${theirsLabel}`)
    }
    if (k >= B.length) break
    out.push(B[k])
    b = k + 1
    o = mo[k] + 1
    t = mt[k] + 1
  }
  return { text: out.join('\n'), conflicts }
}
