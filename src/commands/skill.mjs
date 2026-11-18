// `agent-os skill`: register skills that agent-os does not install (local, external, plugin, builtin), check the
// registry, and vendor third-party skills: add one at a pinned commit, update it (the diff first, written only when
// confirmed), remove it (only the folder the lock records), and scaffold a new local skill. Nothing fetched is run.

import { CliError, EXIT } from '../cli/errors.mjs'
import { ask } from '../cli/prompt.mjs'
import { ORIGINS, readRegistry, registerSkill } from '../registry/registry.mjs'
import { addSkill, fetcherFor, newSkill, removeSkill, updateSkill } from '../registry/vendor.mjs'

export const usage = [
  'agent-os skill add <github:owner/repo[/path]@ref | ./folder> [--name <n>] [--license <id>] [--provides <slot>…] [--dry-run]',
  'agent-os skill update <name> [--ref <commit, tag or branch>] [--from <folder>] [--yes]',
  'agent-os skill remove <name> [--dry-run]   ·   new <name> [--description <d>]',
  'agent-os skill register <name> --origin local|external|plugin|builtin [--source <host:owner/repo@ref>] [--version <v>] [--license <id>] [--provides <slot>…] [--force] [--dry-run]   ·   check',
].join('\n       ')

export const options = {
  origin: { type: 'string', description: `register: ${ORIGINS.filter((o) => o !== 'core').join(', ')}` },
  source: { type: 'string', description: 'register: where it comes from; external skills pin a commit or tag (github:owner/repo@sha)' },
  version: { type: 'string', description: 'register: the skill version' },
  license: { type: 'string', description: 'register, add: its license id (MIT, Apache-2.0, …); add detects it from a LICENSE file' },
  provides: { type: 'string', multiple: true, description: 'register, add: a capability slot it fills (repeat), e.g. review' },
  force: { type: 'boolean', description: 'register: replace an existing entry' },
  name: { type: 'string', description: 'add: the skill name, when its SKILL.md has none' },
  ref: { type: 'string', description: 'update: the commit, tag or branch to move to (default: the ref it was added from)' },
  from: { type: 'string', description: 'update: the folder of a skill vendored from a local folder' },
  yes: { type: 'boolean', description: 'update: replace the files without asking' },
  description: { type: 'string', description: 'new: the skill description' },
}

const diffText = (diff) => diff.map((d) => [`  ${d.status} ${d.path}`, ...d.lines.slice(0, 40).map((l) => `    ${l}`), ...(d.lines.length > 40 ? [`    … ${d.lines.length - 40} more lines`] : [])].join('\n')).join('\n')

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action, name] = ctx.positionals
  const v = ctx.values
  const need = () => { if (!name) throw new CliError(action === 'add' ? 'which source?' : 'which skill?', { hint: `usage: ${usage}` }) }
  switch (action) {
    case 'register': {
      need()
      const r = registerSkill(ctx.cwd, { name, origin: v.origin, source: v.source, version: v.version, license: v.license, provides: v.provides }, { force: v.force, dryRun: ctx.dryRun })
      ctx.output(r, `${r.dryRun ? 'would write' : 'wrote'} ${r.path}`)
      return EXIT.OK
    }
    case 'check': {
      const entries = readRegistry(ctx.cwd)
      const problems = entries.filter((e) => e.problems.length)
      ctx.output({ entries: entries.length, problems }, problems.length ? problems.map((p) => `  ${p.path}: ${p.problems.join('; ')}`).join('\n') : `registry: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, all valid (doctor also checks folders against entries)`)
      return problems.length ? EXIT.CHECK_FAILED : EXIT.OK
    }
    case 'add': {
      need()
      const r = addSkill(ctx.cwd, { source: name, name: v.name, license: v.license, provides: v.provides ?? [], fetch: fetcherFor(ctx.io), dryRun: ctx.dryRun })
      ctx.output(r, `${r.dryRun ? 'would vendor' : 'vendored'} ${r.name} into ${r.folder}/ at ${r.commit} (${Object.keys(r.files).length} files, license ${r.license ?? 'unknown'}); nothing from it was run`)
      return EXIT.OK
    }
    case 'update': {
      need()
      const fetch = fetcherFor(ctx.io)
      const preview = updateSkill(ctx.cwd, { name, ref: v.ref, from: v.from, fetch, yes: false })
      if (preview.upToDate) { ctx.output(preview, `${name} is already at ${preview.commit}`); return EXIT.OK }
      const header = `${name}: ${preview.from} → ${preview.to}, ${preview.diff.length} file(s) change`
      let go = Boolean(v.yes) && !ctx.dryRun
      if (!v.yes && !ctx.dryRun && ctx.io.ask) {
        ctx.io.stderr(`${header}\n${diffText(preview.diff)}\n`)
        go = await ask(ctx.io, { text: 'Replace the vendored files?', kind: 'yesno', default: false })
      }
      if (!go) {
        ctx.output({ ...preview, written: false }, `${header}\n${diffText(preview.diff)}\nnot written: ${ctx.dryRun ? 'dry run' : 'confirm with --yes'}`)
        return ctx.dryRun || v.yes ? EXIT.OK : EXIT.CHECK_FAILED
      }
      const r = updateSkill(ctx.cwd, { name, ref: v.ref, from: v.from, fetch, yes: true })
      ctx.output(r, `${header}\n${diffText(r.diff)}\nupdated ${name} to ${r.to}`)
      return EXIT.OK
    }
    case 'remove': {
      need()
      const r = removeSkill(ctx.cwd, { name, dryRun: ctx.dryRun })
      ctx.output(r, `${r.dryRun ? 'would' : 'did'}:\n  - ${r.steps.join('\n  - ')}`)
      return EXIT.OK
    }
    case 'new': {
      need()
      if (ctx.dryRun) { ctx.output({ dryRun: true, name, folder: `.claude/skills/${name}` }, `would create .claude/skills/${name}/SKILL.md and its registry entry`); return EXIT.OK }
      const r = newSkill(ctx.cwd, { name, description: v.description })
      ctx.output(r, `created .claude/skills/${name}/SKILL.md and ${r.path}; fill in the steps, then agent-os skills shows it`)
      return EXIT.OK
    }
    default: throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
  }
}
