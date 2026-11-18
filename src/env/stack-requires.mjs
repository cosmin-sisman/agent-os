// Requirements the stack implies: a provider the catalog marks with mcpHint suggests an MCP server, and a provider
// with a well-known CLI suggests that tool. They are only proposed: nothing goes into agent-os.json → requires until
// someone accepts it (agent-os env propose --accept), and agent-os env then checks it like any other requirement.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { saveJson } from '../config/config.mjs'
import { loadCatalog } from '../stack/catalog.mjs'
import { parse } from '../yaml/yaml.mjs'

/** The command-line tool of a provider, where there is a well-known one. */
export const PROVIDER_CLIS = {
  vercel: 'vercel', cloudflare: 'wrangler', netlify: 'netlify', railway: 'railway', render: 'render', 'fly-io': 'flyctl',
  digitalocean: 'doctl', aws: 'aws', azure: 'az', supabase: 'supabase', firebase: 'firebase', neon: 'neonctl',
  'mongodb-atlas': 'atlas', stripe: 'stripe', sentry: 'sentry-cli', github: 'gh', gitlab: 'glab', 'eas-expo': 'eas',
}

/** The layers in use with their effective provider (the layer's own, else its technology's). */
function providersInUse(cwd, catalog) {
  const file = join(cwd, 'stack.yaml')
  if (!existsSync(file)) return []
  const stack = parse(readFileSync(file, 'utf8'), { file: 'stack.yaml' }) ?? {}
  return Object.entries(stack.layers ?? {}).filter(([, l]) => (l?.status ?? 'chosen') === 'chosen').map(([layer, l]) => {
    const t = l.tech ? catalog.technologies.get(l.tech) : null
    const id = l.provider ?? t?.provider ?? null
    return id ? { layer, tech: t?.name ?? l.tech ?? null, provider: catalog.providers.get(id) ?? { id, name: id } } : null
  }).filter(Boolean)
}

/**
 * What the stack suggests and the project does not require yet: { id, kind: 'mcp' | 'cli', entry, why }. The MCP
 * entries are optional and user-scoped until the team decides otherwise; agent-os never assumes a server exists.
 */
export function proposeRequirements(cwd, config, { catalog = loadCatalog({ cwd }) } = {}) {
  const haveMcp = new Set((config.requires?.mcp ?? []).map((m) => m.name))
  const haveCli = new Set(Object.keys(config.requires?.cli ?? {}))
  const byProvider = new Map()
  for (const u of providersInUse(cwd, catalog)) {
    const e = byProvider.get(u.provider.id) ?? { provider: u.provider, layers: [] }
    e.layers.push(u.layer)
    byProvider.set(u.provider.id, e)
  }
  const out = []
  for (const { provider, layers } of byProvider.values()) {
    const where = `${layers.join(', ')} ${layers.length === 1 ? 'uses' : 'use'} ${provider.name}`
    if (provider.mcpHint && !haveMcp.has(provider.id)) out.push({ id: `mcp:${provider.id}`, kind: 'mcp', entry: { name: provider.id, scope: 'user', optional: true, why: where }, why: `${where}; the catalog suggests a ${provider.name} MCP server (agent-os env checks it, never assumes it)` })
    const cli = PROVIDER_CLIS[provider.id]
    if (cli && !haveCli.has(cli)) out.push({ id: `cli:${cli}`, kind: 'cli', entry: { name: cli, range: '*' }, why: `${where}; its command-line tool` })
  }
  return out
}

/** Writes the accepted proposals into agent-os.json → requires, keeping everything else. Returns what it added. */
export function acceptRequirements(cwd, proposals, { dryRun = false } = {}) {
  const file = join(cwd, 'agent-os.json')
  let team = {}
  if (existsSync(file)) { try { team = JSON.parse(readFileSync(file, 'utf8')) } catch { throw new CliError('agent-os.json is not valid JSON', { hint: 'agent-os config validate' }) } }
  const requires = { ...(team.requires ?? {}) }
  for (const p of proposals) {
    if (p.kind === 'mcp') requires.mcp = [...(requires.mcp ?? []).filter((m) => m.name !== p.entry.name), p.entry]
    else requires.cli = { ...(requires.cli ?? {}), [p.entry.name]: p.entry.range }
  }
  if (!dryRun && proposals.length) saveJson(cwd, 'agent-os.json', { ...team, requires })
  return proposals.map((p) => p.id)
}
