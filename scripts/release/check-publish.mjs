// Run by .github/workflows/publish.yml before npm publish: the pushed tag must be v<package.json version>, and the
// tagged commit must be on main (a release merge), so exactly that commit is published.
// Usage: node scripts/release/check-publish.mjs <tag>   (exits 1 with the reason when a check fails)

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** The problems with publishing `tag` from this checkout; empty when it may be published. */
export function publishProblems(tag, { version, git, production = 'main' }) {
  const problems = []
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) problems.push(`"${tag}" is not a release tag (vX.Y.Z)`)
  else if (tag !== `v${version}`) problems.push(`the tag ${tag} does not match package.json's version ${version}: release open bumps it in the release commit`)
  const fetched = git(['fetch', '--no-tags', 'origin', production])
  if (fetched.status !== 0) problems.push(`cannot fetch origin/${production}`)
  else if (git(['merge-base', '--is-ancestor', 'HEAD', `origin/${production}`]).status !== 0) problems.push(`the tagged commit is not on ${production}: only a release merged into ${production} is published`)
  return problems
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const git = (args) => spawnSync('git', args, { encoding: 'utf8' })
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
  const problems = publishProblems(process.argv[2], { version, git })
  for (const p of problems) console.error(`::error::${p}`)
  if (problems.length) process.exit(1)
  console.log(`publishing ${process.argv[2]} (package.json ${version}), on main`)
}
