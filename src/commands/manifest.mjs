// `agent-os manifest`: the lifecycle manifest of everything agent-os ships. `build` writes manifest.json (at release),
// `check` applies the release rules against the last release's manifest, `usage` lists the deprecated items this
// project still uses (doctor uses it too).

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { collectItems, buildManifest, checkManifest, readExceptions, deprecatedInUse } from '../lifecycle/manifest.mjs'
import { runningVersion } from '../version/pin.mjs'

export const usage = 'agent-os manifest [build [--out <file>] | check [--previous <file>] | usage]'

export const options = {
  out: { type: 'string', description: 'build: where to write (default manifest.json in the package)' },
  previous: { type: 'string', description: "check: the last release's manifest (default the package's manifest.json)" },
}

export const PACKAGE_MANIFEST = fileURLToPath(new URL('../../manifest.json', import.meta.url))
const readManifest = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null)

/** The manifest of the running code, built on top of the package's last released manifest. */
export async function currentManifest(previousFile = PACKAGE_MANIFEST) {
  return buildManifest({ version: runningVersion(), items: await collectItems(), previous: readManifest(previousFile), exceptions: readExceptions() })
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action = 'check'] = ctx.positionals
  if (action === 'build') {
    const out = ctx.values.out ? resolve(ctx.cwd, ctx.values.out) : PACKAGE_MANIFEST
    const manifest = await currentManifest(out)
    const problems = checkManifest(manifest, readManifest(out))
    if (problems.length) throw new CliError(`the manifest breaks the release rules:\n  - ${problems.join('\n  - ')}`, { code: EXIT.CHECK_FAILED, hint: 'fix src/lifecycle/lifecycle.yaml or add the migration' })
    if (!ctx.dryRun) writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`)
    return ctx.output({ file: out, items: Object.keys(manifest.items).length, dryRun: ctx.dryRun }, `${ctx.dryRun ? 'would write' : 'wrote'} ${out}: ${Object.keys(manifest.items).length} items`)
  }
  if (action === 'check') {
    const prevFile = ctx.values.previous ? resolve(ctx.cwd, ctx.values.previous) : PACKAGE_MANIFEST
    const problems = checkManifest(await currentManifest(prevFile), readManifest(prevFile))
    ctx.output({ problems }, problems.length ? problems.join('\n') : 'the lifecycle rules hold')
    return problems.length ? EXIT.CHECK_FAILED : EXIT.OK
  }
  if (action === 'usage') {
    const { team, local } = loadConfig(ctx.cwd)
    const settings = join(ctx.cwd, '.claude', 'settings.json')
    const hookCommands = existsSync(settings)
      ? Object.values(JSON.parse(readFileSync(settings, 'utf8')).hooks ?? {}).flatMap((groups) => groups.flatMap((g) => (g.hooks ?? []).map((h) => h.command ?? '')))
      : []
    const found = deprecatedInUse(await currentManifest(), { team: team ?? {}, local: local ?? {}, hookCommands })
    ctx.output(found, found.length ? found.map((f) => f.message).join('\n') : 'nothing deprecated is in use')
    return found.length ? EXIT.CHECK_FAILED : EXIT.OK
  }
  throw new CliError(`unknown action "${action}"`, { hint: `usage: ${usage}` })
}
