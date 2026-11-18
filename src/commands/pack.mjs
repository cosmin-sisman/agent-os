// `agent-os pack`: optional bundles of stack knowledge. `list` and `show` describe the packs the package ships; `add`
// installs one (its rules and subagents as managed files, its gate suites, requirements and slots where agent-os.json
// sets nothing); `remove` takes back exactly what the lock recorded, and refuses while a file of it was edited.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig, saveJson } from '../config/config.mjs'
import { languageFor } from '../i18n/i18n.mjs'
import { applyManaged, readLock, removeManaged, writeLock } from '../managed/managed.mjs'
import { addPackConfig, availablePacks, packItems, readPack, removePackConfig } from '../packs/packs.mjs'
import { pinnedVersion } from '../version/pin.mjs'

export const usage = 'agent-os pack list | show <id> | add <id> [--dry-run] | remove <id> [--dry-run]   (agent-os add <id> is the same as pack add)'

export const options = {}

const readTeam = (cwd) => {
  const file = join(cwd, 'agent-os.json')
  if (!existsSync(file)) return {}
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { throw new CliError('agent-os.json is not valid JSON', { hint: 'agent-os config validate' }) }
}
const summary = (a) => Object.entries(a).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.join(', ')}`).join('; ') || 'nothing (agent-os.json already set all of it)'

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx, action = ctx.positionals[0], id = ctx.positionals[1]) {
  const { merged } = loadConfig(ctx.cwd)
  const lang = languageFor(merged, 'docs')
  if (action === 'list' || !action) {
    const rows = availablePacks().map((p) => { const d = readPack(p); return { id: p, name: d.name, description: d.description?.[lang] ?? d.description?.en ?? '', added: (merged.packs ?? []).includes(p) } })
    ctx.output(rows, rows.map((r) => `${r.added ? '*' : ' '} ${r.id.padEnd(18)} ${r.description}`).join('\n') || 'no packs')
    return EXIT.OK
  }
  if (!id) throw new CliError('which pack?', { hint: `usage: ${usage}` })
  const pack = readPack(id)
  if (action === 'show') {
    const items = packItems(id, merged)
    const requires = [...Object.keys(pack.requires?.cli ?? {}), ...(pack.requires?.mcp ?? []).map((m) => `mcp ${m.name}`), ...(pack.requires?.env ?? []).map((e) => `$${e}`)]
    ctx.output({ ...pack, dir: undefined, files: items.map((i) => i.key) }, [`${pack.id}: ${pack.description?.[lang] ?? pack.description?.en ?? ''}`, `files: ${items.map((i) => i.key).join(', ')}`, `gate: ${Object.keys(pack.gate ?? {}).join(', ') || '-'}`, `requires: ${requires.join(', ') || '-'}`].join('\n'))
    return EXIT.OK
  }
  if (action === 'add') {
    if ((merged.packs ?? []).includes(id) && readLock(ctx.cwd).packs?.[id]) { ctx.output({ added: false, id }, `${id} is already added`); return EXIT.OK }
    const { team, added } = addPackConfig(readTeam(ctx.cwd), pack)
    const items = packItems(id, { ...merged, packs: team.packs })
    if (ctx.dryRun) { ctx.output({ dryRun: true, id, files: items.map((i) => i.key), added }, `would add ${id}: ${items.map((i) => i.key).join(', ')}; agent-os.json gets ${summary(added)}`); return EXIT.OK }
    saveJson(ctx.cwd, 'agent-os.json', team)
    const results = applyManaged(ctx.cwd, items, { version: pinnedVersion(merged) })
    const lock = readLock(ctx.cwd)
    lock.packs = { ...lock.packs, [id]: { files: items.map((i) => i.key), added } }
    writeLock(ctx.cwd, lock)
    const conflicts = results.filter((r) => r.action === 'conflict')
    ctx.output({ id, results, added }, `added ${id}: ${results.map((r) => `${r.key} (${r.action})`).join(', ')}; agent-os.json gets ${summary(added)}. Run agent-os env to check what it requires.${conflicts.length ? `\nconflicts: ${conflicts.map((c) => c.rej).join(', ')}` : ''}`)
    return conflicts.length ? EXIT.CHECK_FAILED : EXIT.OK
  }
  if (action === 'remove') {
    const record = readLock(ctx.cwd).packs?.[id]
    if (!record) throw new CliError(`${id} was not added with agent-os (the lock has no record of it)`, { hint: 'agent-os pack list shows the added ones (*)' })
    const check = removeManaged(ctx.cwd, record.files, { dryRun: true })
    if (check.modified.length) throw new CliError(`${id} is not removed: ${check.modified.join(', ')} ${check.modified.length === 1 ? 'was' : 'were'} edited by hand`, { hint: 'keep your version with agent-os eject <file> (then remove the pack), or restore the file; nothing was changed' })
    if (ctx.dryRun) { ctx.output({ dryRun: true, id, files: check.removed, added: record.added }, `would remove ${id}: ${check.removed.join(', ') || 'no files'}; agent-os.json loses ${summary(record.added)}`); return EXIT.OK }
    const done = removeManaged(ctx.cwd, record.files)
    saveJson(ctx.cwd, 'agent-os.json', removePackConfig(readTeam(ctx.cwd), id, record.added))
    const lock = readLock(ctx.cwd)
    const rest = { ...(lock.packs ?? {}) }
    delete rest[id]
    lock.packs = rest
    writeLock(ctx.cwd, lock)
    ctx.output({ id, removed: done.removed, added: record.added }, `removed ${id}: ${done.removed.join(', ') || 'no files'}; agent-os.json lost ${summary(record.added)}`)
    return EXIT.OK
  }
  throw new CliError(`unknown action "${action}"`, { hint: `usage: ${usage}` })
}
