// Did-you-mean helpers: edit distance and the closest candidate that is likely a typo of the input.

/** Edit distance where swapping two adjacent letters costs one edit (optimal string alignment). */
export function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** The candidate closest to `word`, if it is within a third of its length (at least one edit); otherwise undefined. */
export function closest(word, candidates) {
  let best
  for (const c of candidates) {
    const d = distance(word.toLowerCase(), c.toLowerCase())
    if (d <= Math.max(1, Math.floor(c.length / 3)) && (!best || d < best.d)) best = { c, d }
  }
  return best?.c
}
