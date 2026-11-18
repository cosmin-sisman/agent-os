// Platform setup on GitHub: the integration branch (created and made default), a ruleset protecting both branches,
// the core labels and the rolling milestone in the configured languages, and the platform route's files. The plan
// is a list of steps; each says what it will change, and nothing is sent unless the step is applied.

import { labelSet, milestone, LABELS, MILESTONES } from '../i18n/i18n.mjs'

export const RULESET_NAME = 'agent-os: protect branches'

const step = (area, action, description, apply) => ({ area, action, description, apply })

/** All pages of a GitHub list endpoint. */
function all(client, path) {
  const out = []
  for (let page = 1; ; page++) {
    const batch = client.rest('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`) ?? []
    out.push(...batch)
    if (batch.length < 100) return out
  }
}

import { LOOP_CHECK } from '../workflow/loop.mjs'

const exists = (client, path) => {
  try { client.rest('GET', path); return true } catch (err) { if (/HTTP 404/.test(err.output ?? err.message)) return false; throw err }
}

/** The ruleset agent-os wants, for the configured branches. */
export function desiredRuleset(config) {
  const { integration, production, requiredApprovals = 0 } = config.branches
  // The loop check has no exceptions (design §10), so setup always makes it required next to the project's checks.
  const requiredChecks = [...new Set([...(config.branches.requiredChecks ?? []), LOOP_CHECK])]
  return {
    name: RULESET_NAME,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: [...new Set([`refs/heads/${production}`, `refs/heads/${integration}`])], exclude: [] } },
    bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }],
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      { type: 'pull_request', parameters: { required_approving_review_count: requiredApprovals, dismiss_stale_reviews_on_push: false, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: true } },
      ...(requiredChecks.length ? [{ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, required_status_checks: requiredChecks.map((c) => ({ context: c })) } }] : []),
    ],
  }
}

const ruleTypes = (rs) => (rs.rules ?? []).map((r) => r.type).sort().join(',')
const checksOf = (rs) => ((rs.rules ?? []).find((r) => r.type === 'required_status_checks')?.parameters?.required_status_checks ?? []).map((c) => c.context).sort().join(',')

/**
 * Plans the setup of a GitHub repository.
 * @param {object} config merged configuration
 * @param {ReturnType<import('../tracker/gh.mjs').ghClient>} client
 * @param {{ only?: string[] }} [options] areas: branches, ruleset, labels, milestones
 */
export function planGitHubSetup(config, client, { only } = {}) {
  const repo = config.platform.project
  const want = (area) => !only || only.includes(area)
  const steps = []
  const { integration, production } = config.branches

  if (want('branches')) {
    const info = client.rest('GET', `repos/${repo}`)
    if (!exists(client, `repos/${repo}/branches/${encodeURIComponent(integration)}`)) {
      steps.push(step('branches', 'create', `create branch ${integration} from ${production}`, () => {
        const sha = client.rest('GET', `repos/${repo}/git/ref/heads/${encodeURIComponent(production)}`).object.sha
        client.rest('POST', `repos/${repo}/git/refs`, { ref: `refs/heads/${integration}`, sha })
      }))
    }
    if (info.default_branch !== integration) {
      steps.push(step('branches', 'update', `make ${integration} the default branch (now ${info.default_branch}), so "Closes #N" closes issues on merge`, () => client.rest('PATCH', `repos/${repo}`, { default_branch: integration })))
    }
  }

  if (want('ruleset')) {
    const desired = desiredRuleset(config)
    const listed = client.rest('GET', `repos/${repo}/rulesets?per_page=100`) ?? []
    const details = listed.map((r) => client.rest('GET', `repos/${repo}/rulesets/${r.id}`))
    const mine = details.find((r) => r.name === RULESET_NAME)
    const covering = details.find((r) => r.name !== RULESET_NAME && r.target === 'branch' && desired.conditions.ref_name.include.every((ref) => r.conditions?.ref_name?.include?.includes(ref)))
    const target = mine ?? covering
    if (!target) {
      steps.push(step('ruleset', 'create', `protect ${production} and ${integration}: no direct push, no force push, no deletion${desired.rules.length > 3 ? `, required checks: ${[...new Set([...(config.branches.requiredChecks ?? []), LOOP_CHECK])].join(', ')}` : ''}`, () => client.rest('POST', `repos/${repo}/rulesets`, desired)))
    } else {
      const missingTypes = ruleTypes(desired) !== ruleTypes({ rules: target.rules.filter((r) => desired.rules.some((d) => d.type === r.type)) })
      const checksDiffer = checksOf(desired) !== checksOf(target) && desired.rules.some((r) => r.type === 'required_status_checks')
      if (missingTypes || checksDiffer) {
        const merged = { ...desired, name: target.name, bypass_actors: target.bypass_actors ?? desired.bypass_actors, rules: [...target.rules.filter((r) => !desired.rules.some((d) => d.type === r.type)), ...desired.rules] }
        steps.push(step('ruleset', 'update', `update ruleset "${target.name}" (#${target.id}): add ${[missingTypes ? 'missing rules' : null, checksDiffer ? `required checks ${checksOf(desired)}` : null].filter(Boolean).join(' and ')}`, () => client.rest('PUT', `repos/${repo}/rulesets/${target.id}`, merged)))
      }
    }
  }

  if (want('labels')) {
    const existing = all(client, `repos/${repo}/labels`)
    const byName = new Map(existing.map((l) => [l.name.toLowerCase(), l]))
    for (const l of labelSet(config)) {
      const current = byName.get(l.name.toLowerCase())
      if (current) {
        if (current.color.toLowerCase() !== l.color.toLowerCase() || (current.description ?? '') !== l.description) {
          steps.push(step('labels', 'update', `update label ${l.name}: color or description`, () => client.rest('PATCH', `repos/${repo}/labels/${encodeURIComponent(current.name)}`, { color: l.color, description: l.description })))
        }
        continue
      }
      const entry = LABELS.find((x) => x.id === l.id)
      const other = Object.values(entry.name).map((n) => byName.get(n.toLowerCase())).find(Boolean)
      if (other) {
        steps.push(step('labels', 'rename', `rename label ${other.name} → ${l.name} (it stays on its issues)`, () => client.rest('PATCH', `repos/${repo}/labels/${encodeURIComponent(other.name)}`, { new_name: l.name, color: l.color, description: l.description })))
      } else {
        steps.push(step('labels', 'create', `create label ${l.name}`, () => client.rest('POST', `repos/${repo}/labels`, { name: l.name, color: l.color, description: l.description })))
      }
    }
  }

  if (want('milestones')) {
    const lang = config.languages.milestones
    const milestones = all(client, `repos/${repo}/milestones?state=all`)
    const entry = MILESTONES.find((m) => m.id === 'rolling-release')
    const patternFor = (title) => new RegExp(`^${title.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace('\\{n\\}', '(\\d+)').replace('{n}', '(\\d+)')}$`)
    const matches = (m, l) => patternFor(entry.title[l]).exec(m.title)
    const open = milestones.filter((m) => m.state === 'open')
    const current = open.find((m) => matches(m, lang))
    const otherLang = open.find((m) => Object.keys(entry.title).some((l) => l !== lang && matches(m, l)))
    if (!current && otherLang) {
      const n = Object.keys(entry.title).map((l) => matches(otherLang, l)).find(Boolean)[1]
      const next = milestone('rolling-release', lang, { n })
      steps.push(step('milestones', 'rename', `rename milestone "${otherLang.title}" → "${next.title}" (its issues stay)`, () => client.rest('PATCH', `repos/${repo}/milestones/${otherLang.number}`, { title: next.title, description: next.description })))
    } else if (!current) {
      const done = milestones.map((m) => Number(m.title.match(/Release (\d+)/)?.[1] ?? 0))
      const next = milestone('rolling-release', lang, { n: Math.max(0, ...done) + 1 })
      steps.push(step('milestones', 'create', `create milestone "${next.title}" for work outside the roadmap stages`, () => client.rest('POST', `repos/${repo}/milestones`, { title: next.title, description: next.description })))
    }
  }

  return steps
}
