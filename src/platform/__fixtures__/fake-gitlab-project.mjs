// Test helper: an in-memory GitLab project behind a fake `glab api`, enough for platform setup: branches, the default
// branch, protected branches, merge checks, approval rules (Premium only), labels and milestones.

export function fakeGitLabProject({ project = 'team/app', branches = ['main'], defaultBranch = 'main', protectedBranches = [], labels = [], milestones = [], premium = false, settings = {} } = {}) {
  const id = encodeURIComponent(project)
  const state = { branches: [...branches], defaultBranch, protectedBranches: structuredClone(protectedBranches), labels: structuredClone(labels), milestones: structuredClone(milestones), approvalRules: premium ? [] : null, settings: { only_allow_merge_if_pipeline_succeeds: false, only_allow_merge_if_all_discussions_are_resolved: false, ...settings } }
  const writes = []
  const ok = (body) => ({ status: 0, stdout: JSON.stringify(body ?? {}), stderr: '' })
  const notFound = () => ({ status: 1, stdout: '', stderr: 'glab: 404 Not Found (HTTP 404)' })
  const run = (args, { input } = {}) => {
    const method = args[args.indexOf('--method') + 1]
    const full = args[args.indexOf('--method') + 2]
    const body = input ? JSON.parse(input) : {}
    const [path, query = ''] = full.split('?')
    const q = new URLSearchParams(query)
    if (method !== 'GET') writes.push(`${method} ${full}`)
    const pre = `projects/${id}`
    const page = (list) => (Number(q.get('page') ?? 1) > 1 ? [] : list)
    if (path === pre && method === 'GET') return ok({ default_branch: state.defaultBranch, ...state.settings })
    if (path === pre && method === 'PUT') { if (body.default_branch) state.defaultBranch = body.default_branch; Object.assign(state.settings, Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'default_branch'))); return ok({}) }
    if (path.startsWith(`${pre}/repository/branches/`)) return state.branches.includes(decodeURIComponent(path.split('/').pop())) ? ok({}) : notFound()
    if (path === `${pre}/repository/branches` && method === 'POST') { state.branches.push(q.get('branch')); return ok({}) }
    if (path === `${pre}/protected_branches` && method === 'GET') return ok(page(state.protectedBranches))
    if (path === `${pre}/protected_branches` && method === 'POST') { state.protectedBranches.push({ name: body.name, push_access_levels: [{ access_level: body.push_access_level }], merge_access_levels: [{ access_level: body.merge_access_level }], allow_force_push: body.allow_force_push }); return ok({}) }
    if (path === `${pre}/approval_rules`) {
      if (state.approvalRules === null) return { status: 1, stdout: '', stderr: 'glab: 403 Forbidden (HTTP 403)' }
      if (method === 'GET') return ok(state.approvalRules)
      state.approvalRules.push(body); return ok({})
    }
    if (path === `${pre}/labels` && method === 'GET') return ok(page(state.labels))
    if (path === `${pre}/labels` && method === 'POST') { state.labels.push({ name: body.name, color: body.color, description: body.description }); return ok({}) }
    if (path.startsWith(`${pre}/labels/`) && method === 'PUT') {
      const l = state.labels.find((x) => x.name === decodeURIComponent(path.split('/').pop()))
      if (!l) return notFound()
      if (body.new_name) l.name = body.new_name
      if (body.description !== undefined) l.description = body.description
      return ok(l)
    }
    if (path === `${pre}/milestones` && method === 'GET') return ok(page(state.milestones))
    if (path === `${pre}/milestones` && method === 'POST') { state.milestones.push({ id: 100 + state.milestones.length, title: body.title, description: body.description, state: 'active' }); return ok({}) }
    if (path.startsWith(`${pre}/milestones/`) && method === 'PUT') { const m = state.milestones.find((x) => String(x.id) === path.split('/').pop()); Object.assign(m, body); return ok(m) }
    return notFound()
  }
  return { run, state, writes }
}
