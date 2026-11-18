// What agent-os installs into a project: the core templates plus the route of the configured platform, rendered for
// the project's configuration. The lock records the platform, so an update only ever writes the active route.

import { codeownersLines, codeownersPath } from '../stack/areas.mjs'
import { availablePacks, packItems } from '../packs/packs.mjs'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildContext, renderTree } from '../templates/tree.mjs'
import { render } from '../templates/engine.mjs'
import { languageFor } from '../i18n/i18n.mjs'
import { languagesInUse, stackLayers } from '../stack/stack.mjs'
import { applyManaged, readLock, writeLock } from './managed.mjs'
import { aliasesFor } from '../platform/vocabulary.mjs'
import { hooksContent } from './managed.mjs'
import { settingsHooks } from '../hooks/runner.mjs'
import { hookCommand } from '../version/pin.mjs'
import { CliError } from '../cli/errors.mjs'
import { coreEntry, REGISTRY_DIR } from '../registry/registry.mjs'
import { BUILTIN_SKILLS, slotsFor } from '../registry/slots.mjs'

export const TEMPLATES = fileURLToPath(new URL('../../templates/', import.meta.url))

/**
 * The files to install: core and the active platform route, rendered. Core and route may not write the same path.
 * @param {object} config merged configuration
 * @param {{ templatesRoot?: string }} [options]
 * @returns {{ platform: string, items: { key: string, content: string, route: string }[], aliases: { alias: string, target: string }[] }}
 */
export function planInstall(config, { templatesRoot = TEMPLATES, cwd } = {}) {
  const platform = config.platform?.type ?? 'github'
  // Legacy features are installed only when the project opts in (#69); unknown ids are left to doctor.
  const legacy = (config.legacy ?? []).filter((id) => /^[\w-]+$/.test(id)).map((id) => [`legacy/${id}`, join(templatesRoot, 'legacy', id)])
  const routes = [['core', join(templatesRoot, 'core')], [`platform/${platform}`, join(templatesRoot, 'platform', platform)], ...legacy]
  const items = []
  const seen = new Map()
  for (const [route, dir] of routes) {
    if (!existsSync(dir)) continue
    for (const f of renderTree(dir, config)) {
      if (seen.has(f.path)) throw new CliError(`${f.path} comes from both ${seen.get(f.path)} and ${route}`, { hint: 'a platform route may add files, never override core ones' })
      seen.set(f.path, route)
      items.push({ key: f.path, content: f.content, route })
    }
  }
  // A route that installs .gitlab/agent-os-*.yml job files wires them into .gitlab-ci.yml include list, as a
  // managed block inside the project's own list, never a second include key (#233).
  const jobs = items.filter((i) => /^\.gitlab\/agent-os-[\w-]+\.yml$/.test(i.key)).map((i) => i.key).sort()
  if (jobs.length) items.push({ key: '.gitlab-ci.yml#include', content: jobs.map((k) => `  - local: ${k}`).join('\n'), route: `platform/${platform}` })
  // Language rules for the stack in use, scoped to the layers' paths (#101).
  if (cwd) for (const r of stackRules(config, { templatesRoot, cwd })) items.push(r)
  // Packs the project added (#55): their rules and subagents are managed files like the rest.
  for (const id of config.packs ?? []) if (availablePacks().includes(id)) items.push(...packItems(id, config))
  // One registry entry per core skill (#38): the registry describes every skill on disk.
  for (const it of [...items]) {
    const m = it.key.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/)
    if (!m) continue
    const description = it.content.match(/^description:\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, '').split(/(?<=\.)\s/)[0]
    items.push({ key: `${REGISTRY_DIR}/${m[1]}.json`, content: `${JSON.stringify(coreEntry(m[1], { version: config.version ?? null, description }), null, 2)}\n`, route: it.route })
  }
  // The built-in skills the slots bind by default, registered so doctor and the index know them (#40).
  const bound = new Set(Object.values(slotsFor(config)).filter(Boolean))
  for (const [name, b] of Object.entries(BUILTIN_SKILLS)) {
    if (bound.has(name)) items.push({ key: `${REGISTRY_DIR}/${name}.json`, content: `${JSON.stringify({ name, origin: 'builtin', source: 'claude-code', provides: b.provides, managed: true, description: b.description }, null, 2)}\n`, route: 'core' })
  }
  // Managed blocks in the agent files: the team's own text around them is never touched (#49).
  items.push({ key: 'AGENTS.md#agent-os', content: agentsBlock(config), route: 'core' })
  items.push({ key: 'CLAUDE.md#agent-os', content: '@AGENTS.md', route: 'core' })
  // The hooks block in .claude/settings.json, always with the pinned command (#65).
  // CODEOWNERS from the stack's layer owners (#75), as a block: the team's own lines are never touched.
  if (cwd) { const owners = codeownersLines(cwd); if (owners) items.push({ key: `${codeownersPath(cwd)}#areas`, content: owners, route: 'core' }) }
  items.push({ key: '.claude/settings.json#hooks', content: hooksContent(settingsHooks(hookCommand(config, { cwd }))), route: 'core' })
  return { platform, items: items.sort((a, b) => a.key.localeCompare(b.key)), aliases: aliasesFor(platform) }
}

/**
 * Installs or updates the project's managed files for the active platform route.
 * @param {string} cwd
 * @param {object} config merged configuration
 * @param {{ version: string, dryRun?: boolean, templatesRoot?: string }} options
 */
export function installRoutes(cwd, config, { version, dryRun = false, templatesRoot } = {}) {
  const plan = planInstall(config, { templatesRoot, cwd })
  const lock = readLock(cwd)
  if (lock.platform && lock.platform !== plan.platform) {
    throw new CliError(`this project was installed for ${lock.platform}, and agent-os.json now says ${plan.platform}`, { hint: 'switching platform rewrites every platform route on its own branch; follow #98 (agent-os platform switch)' })
  }
  const results = applyManaged(cwd, plan.items, { version, dryRun })
  if (!dryRun) writeLock(cwd, { ...readLock(cwd), platform: plan.platform })
  return { platform: plan.platform, aliases: plan.aliases, results }
}

/**
 * The agent-os block in AGENTS.md, in the docs language: where the rules, skills and checks are, and how an agent
 * other than Claude Code runs a skill (decision 2026-11-18-other-agents-agents-md-first). `ro` is ASCII.
 */
export function agentsBlock(config) {
  const { integration, production } = config.branches ?? {}
  const v = config.version ? ` ${config.version}` : ''
  const int = integration ?? 'development'
  const prod = production ?? 'main'
  const cli = hookCommand(config)
  const lines = languageFor(config, 'docs') === 'ro'
    ? [
      `Acest repository urmeaza agent-os${v}. Reguli in \`.claude/rules/\`, skill-uri in \`.claude/skills/\` (incepe cu /next, /start, /pr si /ship), setarile echipei in \`agent-os.json\`.`,
      `Munca ajunge in \`${int}\` prin change requests; \`${prod}\` se schimba doar prin /release. \`agent-os doctor\` verifica setup-ul.`,
      `Daca \`agent-os\` nu e instalat, ruleaza fiecare comanda ca \`${cli} <comanda>\` (niciodata un pachet \`agent-os\` fara scope).`,
      'Alt agent decat Claude Code: o cerere pentru `/<name>` inseamna sa citesti `.claude/skills/<name>/SKILL.md` si sa il urmezi; fiecare pas din el este o comanda `agent-os`.',
    ]
    : [
      `This repository follows agent-os${v}. Rules in \`.claude/rules/\`, skills in \`.claude/skills/\` (start with /next, /start, /pr and /ship), team settings in \`agent-os.json\`.`,
      `Work goes to \`${int}\` through change requests; \`${prod}\` changes only through /release. \`agent-os doctor\` checks the setup.`,
      `Where \`agent-os\` is not installed, run each command as \`${cli} <command>\` (never an unscoped \`agent-os\` package).`,
      'In an agent other than Claude Code, a request for `/<name>` means reading `.claude/skills/<name>/SKILL.md` and following it; every step in it is an `agent-os` command.',
    ]
  return ['## agent-os', '', ...lines].join('\n')
}

/**
 * The language rules for the languages stack.yaml uses: templates/stack/<language>.<en|ro>.md in the docs language,
 * with Claude Code `paths:` front matter so each loads only for its layers' files.
 */
export function stackRules(config, { templatesRoot = TEMPLATES, cwd }) {
  const lang = languageFor(config, 'docs')
  const context = buildContext(config)
  const out = []
  for (const l of languagesInUse(stackLayers(cwd))) {
    const file = join(templatesRoot, 'stack', `${l.language}.${lang}.md`)
    if (!existsSync(file)) continue
    const body = render(readFileSync(file, 'utf8'), { ...context, paths: l.paths.length ? l.paths.map((p) => `\`${p}\``).join(', ') : (lang === 'ro' ? 'tot repository-ul' : 'the whole repository'), lowAi: l.lowAi.join(', ') }, { file: `stack/${l.language}.${lang}.md` })
    const front = l.paths.length ? `---\npaths:\n${l.paths.map((p) => `  - "${p}"`).join('\n')}\n---\n\n` : ''
    out.push({ key: `.claude/rules/stack/${l.language}.md`, content: `${front}${body.replace(/^\n+/, '')}`, route: 'stack' })
  }
  // Layers agents know poorly (aiFriendly ≤ 2) in a language with no rule template still get "read the docs first",
  // scoped to their paths (#80).
  const covered = new Set(languagesInUse(stackLayers(cwd)).filter((l) => existsSync(join(templatesRoot, 'stack', `${l.language}.${lang}.md`))).map((l) => l.language))
  const low = stackLayers(cwd).filter((l) => l.aiFriendly <= 2 && !covered.has(l.language))
  if (low.length) {
    const paths = [...new Set(low.flatMap((l) => l.paths))]
    const front = paths.length && low.every((l) => l.paths.length) ? `---\npaths:\n${paths.map((p) => `  - "${p}"`).join('\n')}\n---\n\n` : ''
    const items = low.map((l) => `- **${l.techName}** (${l.id}${l.paths.length ? `: ${l.paths.map((p) => `\`${p}\``).join(', ')}` : ''})`).join('\n')
    const body = lang === 'ro'
      ? `# Citeste documentatia intai\n\nAgentii cunosc slab aceste tehnologii (catalog: aiFriendly 2 sau mai putin). Inainte sa scrii cod, citeste documentatia oficiala pentru versiunea folosita (printr-un MCP de documentatie, daca exista) si citeaz-o in change request:\n\n${items}\n`
      : `# Read the docs first\n\nAgents know these technologies poorly (catalog: aiFriendly 2 or less). Before writing code, read the official documentation for the version in use (through a docs MCP server when one is configured) and cite it in the change request:\n\n${items}\n`
    out.push({ key: '.claude/rules/stack/read-the-docs.md', content: `${front}${body}`, route: 'stack' })
  }
  return out
}
