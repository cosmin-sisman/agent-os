// Builds the capability map for the configured platform and caches it in .agent-os/cache/platform.json.

import { probeGitHub, probeGitLab, readCache, writeCache } from './capabilities.mjs'
import { ghClient } from '../tracker/gh.mjs'
import { glabClient } from './glab.mjs'

/**
 * @param {object} config merged configuration
 * @param {{ cwd: string, refresh?: boolean, gh?: Function, glab?: Function, now?: Date }} options
 * @returns {Promise<{ platform: string, host: string, probedAt: string, fromCache: boolean, capabilities: object }>}
 */
export async function capabilitiesFor(config, { cwd, refresh = false, gh, glab, now = new Date() }) {
  const p = config.platform ?? {}
  const host = p.host ? new URL(p.host).host : p.type === 'gitlab' ? 'gitlab.com' : 'github.com'
  const cached = refresh ? null : readCache(cwd, { now: now.getTime() })
  if (cached && cached.platform === p.type && cached.host === host && cached.project === p.project) return { ...cached, fromCache: true }
  const capabilities = p.type === 'gitlab'
    ? await probeGitLab(p, glabClient(glab, { host }))
    : await probeGitHub(p, ghClient(gh, { host }))
  const map = { platform: p.type ?? 'github', host, project: p.project ?? null, probedAt: now.toISOString(), capabilities }
  writeCache(cwd, map)
  return { ...map, fromCache: false }
}
