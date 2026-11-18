// Self-managed and on-premise networks: a private CA (platform.caFile), an HTTP proxy (machine.proxy, personal) and
// an internal npm registry (npmRegistry). They reach every tool agent-os runs (gh, glab, git, npx) through the
// environment of this process only; nothing is written to the machine (no certificate store, npm or git config).

import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

/** Variables a tool understands, for each setting. Values that are already set in the environment always win. */
export function networkEnv(config, cwd) {
  const out = {}
  const ca = config.platform?.caFile
  if (ca) {
    const file = isAbsolute(ca) ? ca : resolve(cwd, ca)
    // Node (npx, agent-os itself when started by a hook), Go tools (gh, glab), git.
    Object.assign(out, { NODE_EXTRA_CA_CERTS: file, SSL_CERT_FILE: file, GIT_SSL_CAINFO: file })
  }
  const proxy = config.machine?.proxy
  if (proxy) Object.assign(out, { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, https_proxy: proxy, http_proxy: proxy })
  const noProxy = config.machine?.noProxy
  if (noProxy?.length) { const v = noProxy.join(','); Object.assign(out, { NO_PROXY: v, no_proxy: v }) }
  if (config.npmRegistry) out.npm_config_registry = config.npmRegistry
  return out
}

/**
 * Sets the variables in `env` (this process's environment) that are not already set, and returns their names, never
 * their values: a proxy URL can hold credentials.
 */
export function applyNetwork(config, cwd, env) {
  const applied = []
  for (const [k, v] of Object.entries(networkEnv(config, cwd))) {
    if (env[k] === undefined || env[k] === '') { env[k] = v; applied.push(k) }
  }
  return applied
}

/** Problems with the network settings: a missing CA file, credentials in a proxy URL. Values are never shown. */
export function networkProblems(config, cwd) {
  const out = []
  const ca = config.platform?.caFile
  if (ca && !existsSync(isAbsolute(ca) ? ca : resolve(cwd, ca))) out.push({ level: 'fail', message: `platform.caFile ${ca} does not exist`, fix: 'commit the CA bundle (PEM) at that path, or fix the path' })
  for (const [key, url] of [['machine.proxy', config.machine?.proxy], ['npmRegistry', config.npmRegistry]]) {
    if (!url) continue
    let u = null
    try { u = new URL(url) } catch { out.push({ level: 'fail', message: `${key} is not a URL`, fix: 'for example http://proxy.corp:3128' }); continue }
    if (u.username || u.password) out.push({ level: 'fail', message: `${key} holds credentials (value not shown)`, fix: 'remove them from the file; put the full URL in HTTPS_PROXY on your laptop (or the registry token in ~/.npmrc), and rotate the exposed password' })
  }
  return out
}
