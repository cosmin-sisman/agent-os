// Platform setup on GitLab (gitlab.com or self-managed): the integration branch as default, both branches protected,
// merges only with a passing pipeline and resolved threads, approval rules where the tier has them, scoped labels and
// the rolling milestone. Like the GitHub setup, it completes what exists and never replaces it. Design §20.

import { LABELS, MILESTONES, label, languageFor, milestone, renderLabel } from '../i18n/i18n.mjs'

const step = (area, action, description, apply) => ({ area, action, description, apply })
const enc = encodeURIComponent

/** Every page of a list endpoint. */
function all(client, path) {
  const out = []
  for (let page = 1; page <= 20; page++) {
    const batch = client.rest('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`) ?? []
    out.push(...batch)
    if (batch.length < 100) break
  }
  return out
}
const exists = (client, path) => { try { client.rest('GET', path); return true } catch (err) { if (/HTTP 404/.test(err.output ?? err.message)) return false; throw err } }

/**
 * @param {object} config merged configuration
 * @param {ReturnType<import('./glab.mjs').glabClient>} client
 * @param {{ only?: string[] }} [options]
 */
export function planGitLabSetup(config, client, { only, areas = [] } = {}) {
  const id = enc(config.platform.project)
  const p = (path) => `projects/${id}/${path}`
  const want = (area) => !only || only.includes(area)
  const steps = []
  const { integration, production, requiredApprovals = 0 } = config.branches
  const project = client.rest('GET', `projects/${id}`)

  if (want('branches')) {
    if (!exists(client, p(`repository/branches/${enc(integration)}`))) {
      steps.push(step('branches', 'create', `create branch ${integration} from ${production}`, () => client.rest('POST', p(`repository/branches?branch=${enc(integration)}&ref=${enc(production)}`))))
    }
    if (project.default_branch !== integration) {
      steps.push(step('branches', 'update', `make ${integration} the default branch (now ${project.default_branch}), so "Closes #N" closes issues on merge`, () => client.rest('PUT', `projects/${id}`, { default_branch: integration })))
    }
  }

  // GitLab's counterpart of the ruleset: protected branches, merge checks and approval rules.
  if (want('ruleset')) {
    const protectedBranches = all(client, p('protected_branches'))
    for (const name of [...new Set([production, integration])]) {
      const current = protectedBranches.find((b) => b.name === name)
      if (!current) {
        steps.push(step('ruleset', 'create', `protect ${name}: no direct push, merges by developers and maintainers, no force push`, () => client.rest('POST', p('protected_branches'), { name, push_access_level: 0, merge_access_level: 30, allow_force_push: false })))
      } else {
        const push = (current.push_access_levels ?? []).map((a) => a.access_level)
        const differs = [push.some((l) => l > 0) && 'direct pushes are allowed', current.allow_force_push && 'force push is allowed'].filter(Boolean)
        if (differs.length) steps.push(step('ruleset', 'keep', `keep the protection of ${name} as it is: ${differs.join(' and ')} (agent-os would allow neither; change it in Settings → Repository if you agree)`, () => {}))
      }
    }
    const checks = [!project.only_allow_merge_if_pipeline_succeeds && ['only_allow_merge_if_pipeline_succeeds', 'merge only when the pipeline succeeds (agent-os/loop included)'], !project.only_allow_merge_if_all_discussions_are_resolved && ['only_allow_merge_if_all_discussions_are_resolved', 'merge only when every thread is resolved']].filter(Boolean)
    if (checks.length) steps.push(step('ruleset', 'update', `merge checks: ${checks.map((c) => c[1]).join('; ')} (other project settings are kept)`, () => client.rest('PUT', `projects/${id}`, Object.fromEntries(checks.map((c) => [c[0], true])))))
    if (requiredApprovals > 0) {
      let rules = null
      try { rules = client.rest('GET', p('approval_rules')) ?? [] } catch { rules = null }
      if (rules === null) steps.push(step('ruleset', 'keep', `approval rules need GitLab Premium: ${requiredApprovals} approval(s) cannot be required here (reviews stay a convention, checked by /ship)`, () => {}))
      else if (!rules.some((r) => (r.approvals_required ?? 0) >= requiredApprovals)) steps.push(step('ruleset', 'create', `require ${requiredApprovals} approval(s) on merge requests`, () => client.rest('POST', p('approval_rules'), { name: 'agent-os', approvals_required: requiredApprovals })))
    }
  }

  if (want('labels')) {
    const lang = languageFor(config, 'labels')
    const existing = all(client, p('labels?include_ancestor_groups=false'))
    const byName = new Map(existing.map((l) => [l.name.toLowerCase(), l]))
    for (const entry of [...LABELS, ...areas]) {
      const l = renderLabel(entry, lang, { scoped: true })
      const ours = (d) => !d || Object.values(entry.description).includes(d)
      const current = byName.get(l.name.toLowerCase())
      if (current) {
        const keepColor = String(current.color).replace('#', '').toLowerCase() !== l.color.toLowerCase()
        if ((current.description ?? '') !== l.description && ours(current.description)) steps.push(step('labels', 'update', `set the description of label ${l.name}${current.description ? ' in the labels language' : ' (it had none)'}; its color stays`, () => client.rest('PUT', p(`labels/${enc(current.name)}`), { description: l.description })))
        else if (keepColor || !ours(current.description)) steps.push(step('labels', 'keep', `keep label ${l.name} as it is: ${[keepColor && `color ${current.color} (the convention uses #${l.color})`, !ours(current.description) && 'its own description'].filter(Boolean).join(' and ')}`, () => {}))
        continue
      }
      // The same label under another language or without scoping (type:bug) is renamed, so it stays on its issues.
      const other = [...Object.values(entry.name), ...Object.values(entry.name).map((n) => n.replace(':', '::'))].map((n) => byName.get(n.toLowerCase())).find(Boolean)
      if (other) steps.push(step('labels', 'rename', `rename label ${other.name} → ${l.name} (it stays on its issues; its color stays)`, () => client.rest('PUT', p(`labels/${enc(other.name)}`), { new_name: l.name, ...(ours(other.description) ? { description: l.description } : {}) })))
      else steps.push(step('labels', 'create', `create label ${l.name}`, () => client.rest('POST', p('labels'), { name: l.name, color: `#${l.color}`, description: l.description })))
    }
  }

  if (want('milestones')) {
    const lang = languageFor(config, 'milestones')
    const milestones = all(client, p('milestones'))
    const entry = MILESTONES.find((m) => m.id === 'rolling-release')
    const patternFor = (title) => new RegExp(`^${title.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace('\\{n\\}', '(\\d+)').replace('{n}', '(\\d+)')}$`)
    const open = milestones.filter((m) => m.state === 'active')
    const current = open.find((m) => patternFor(entry.title[lang]).test(m.title))
    const otherLang = open.find((m) => Object.keys(entry.title).some((l) => l !== lang && patternFor(entry.title[l]).test(m.title)))
    if (!current && otherLang) {
      const n = Object.keys(entry.title).map((l) => patternFor(entry.title[l]).exec(otherLang.title)).find(Boolean)[1]
      const next = milestone('rolling-release', lang, { n })
      steps.push(step('milestones', 'rename', `rename milestone "${otherLang.title}" → "${next.title}" (its issues, due date${otherLang.description ? ' and description' : ''} stay)`, () => client.rest('PUT', p(`milestones/${otherLang.id}`), { title: next.title, ...(otherLang.description ? {} : { description: next.description }) })))
    } else if (!current) {
      const done = milestones.map((m) => Number(m.title.match(/Release (\d+)/)?.[1] ?? 0))
      const next = milestone('rolling-release', lang, { n: Math.max(0, ...done) + 1 })
      steps.push(step('milestones', 'create', `create milestone "${next.title}" for work outside the roadmap stages`, () => client.rest('POST', p('milestones'), { title: next.title, description: next.description })))
    }
  }
  return steps
}
