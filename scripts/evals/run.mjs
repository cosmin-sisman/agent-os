// Runs the skill evals and prints one line per scenario, with the map and recall savings.
// Usage: node scripts/evals/run.mjs [--json]   (exits 1 when a scenario fails; model scenarios are skipped)

import { runEvals } from './scenarios.mjs'

const r = runEvals()
if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2))
else {
  for (const x of r.results) console.log(`${x.ok ? 'ok  ' : 'FAIL'} ${x.id}: ${x.detail}`)
  for (const s of r.skipped) console.log(`skip ${s.id}: ${s.skipped}`)
  console.log(`\n${r.results.filter((x) => x.ok).length}/${r.results.length} passed, ${r.skipped.length} skipped`)
}
if (!r.ok) process.exit(1)
