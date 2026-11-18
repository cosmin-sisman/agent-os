// Packs: optional bundles of stack knowledge, kept out of core (design §6). A pack (templates/packs/<id>/pack.yaml)
// brings rules, subagents, gate suites and paths, requirements and slot bindings. `pack add` installs its files as
// managed items and adds its configuration to agent-os.json where nothing is set; the lock records exactly what it
// added, so `pack remove` takes back only that, and refuses while one of its files was edited by hand.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CliError } from '../cli/errors.mjs'
import { parse } from '../yaml/yaml.mjs'
import { render } from '../templates/engine.mjs'
import { buildContext } from '../templates/tree.mjs'
import { languageFor } from '../i18n/i18n.mjs'
import { closest } from '../util/closest.mjs'

export const PACKS = fileURLToPath(new URL('../../templates/packs/', import.meta.url))

/** The packs the package ships. */
export const availablePacks = (dir = PACKS) => (existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(join(dir, d, 'pack.yaml'))).sort() : [])

/** A pack's definition, or a refusal naming the closest one. */
export function readPack(id, dir = PACKS) {
  const file = join(dir, String(id), 'pack.yaml')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(id)) || !existsSync(file)) {
    const near = closest(String(id), availablePacks(dir))
    throw new CliError(`no pack "${id}"${near ? ` (did you mean "${near}"?)` : ''}`, { hint: `packs: ${availablePacks(dir).join(', ') || 'none'}` })
  }
  return { dir: join(dir, id), ...parse(readFileSync(file, 'utf8'), { file: `packs/${id}/pack.yaml` }) }
}

/** The managed files of a pack, rendered for the project (rules in the docs language, subagents as they are). */
export function packItems(id, config, dir = PACKS) {
  const p = readPack(id, dir)
  const lang = languageFor(config, 'docs')
  const ctx = buildContext(config)
  const items = []
  for (const r of p.rules ?? []) {
    const name = r.split('/').pop()
    const src = [`${r}.${lang}.md`, `${r}.en.md`, `${r}.md`].map((f) => join(p.dir, f)).find(existsSync)
    if (!src) throw new CliError(`pack ${id}: rule ${r} has no file`)
    items.push({ key: `.claude/rules/packs/${id}/${name}.md`, content: render(readFileSync(src, 'utf8'), ctx, { file: `packs/${id}/${r}` }).replace(/^\n+/, ''), route: `pack:${id}` })
  }
  for (const a of p.agents ?? []) items.push({ key: `.claude/agents/${a.split('/').pop()}`, content: readFileSync(join(p.dir, a), 'utf8'), route: `pack:${id}` })
  return items
}

/**
 * What adding a pack changes in agent-os.json: only keys that are not set already, so the team's own settings win.
 * Returns the new team config and the record of what was added (kept in the lock for remove).
 */
export function addPackConfig(team, pack) {
  const t = structuredClone(team ?? {})
  const added = { gate: [], gatePaths: [], cli: [], mcp: [], env: [], slots: [] }
  t.packs = [...new Set([...(t.packs ?? []), pack.id])]
  for (const [name, cmd] of Object.entries(pack.gate ?? {})) if (t.gate?.[name] === undefined) { (t.gate ??= {})[name] = cmd; added.gate.push(name) }
  for (const [glob, suites] of Object.entries(pack.gatePaths ?? {})) if (t.gatePaths?.[glob] === undefined) { (t.gatePaths ??= {})[glob] = suites; added.gatePaths.push(glob) }
  for (const [name, range] of Object.entries(pack.requires?.cli ?? {})) if (t.requires?.cli?.[name] === undefined) { ((t.requires ??= {}).cli ??= {})[name] = range; added.cli.push(name) }
  for (const m of pack.requires?.mcp ?? []) if (!(t.requires?.mcp ?? []).some((x) => x.name === m.name)) { ((t.requires ??= {}).mcp ??= []).push(m); added.mcp.push(m.name) }
  for (const e of pack.requires?.env ?? []) if (!(t.requires?.env ?? []).includes(e)) { ((t.requires ??= {}).env ??= []).push(e); added.env.push(e) }
  for (const [slot, skill] of Object.entries(pack.slots ?? {})) if (!t.slots?.[slot]) { (t.slots ??= {})[slot] = skill; added.slots.push(slot) }
  return { team: t, added }
}

/** agent-os.json without what a pack added (as the lock recorded it); everything else is kept. */
export function removePackConfig(team, id, added = {}) {
  const t = structuredClone(team ?? {})
  t.packs = (t.packs ?? []).filter((p) => p !== id)
  for (const n of added.gate ?? []) delete t.gate?.[n]
  for (const g of added.gatePaths ?? []) delete t.gatePaths?.[g]
  for (const n of added.cli ?? []) delete t.requires?.cli?.[n]
  if (t.requires?.mcp) t.requires.mcp = t.requires.mcp.filter((m) => !(added.mcp ?? []).includes(m.name))
  if (t.requires?.env) t.requires.env = t.requires.env.filter((e) => !(added.env ?? []).includes(e))
  for (const s of added.slots ?? []) delete t.slots?.[s]
  for (const k of ['gate', 'gatePaths', 'slots']) if (t[k] && !Object.keys(t[k]).length) delete t[k]
  for (const k of ['cli', 'mcp', 'env']) if (t.requires?.[k] && !(Array.isArray(t.requires[k]) ? t.requires[k].length : Object.keys(t.requires[k]).length)) delete t.requires[k]
  if (t.requires && !Object.keys(t.requires).length) delete t.requires
  if (!t.packs.length) delete t.packs
  return t
}
