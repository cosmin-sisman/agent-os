// Test helper: an in-memory GitHub repository behind a fake `gh api`, with the semantics setup relies on: branches,
// the default branch, rulesets, labels attached to issues (a rename keeps them attached), and milestones.

export function fakeGitHubRepo({ repo = 'acme/app', branches = { main: 'sha-main' }, defaultBranch = 'main', labels = [], milestones = [], rulesets = [], issues = {} } = {}) {
  const state = { defaultBranch, branches: { ...branches }, labels: labels.map((l) => ({ description: '', ...l })), milestones: milestones.map((m, i) => ({ number: i + 1, state: 'open', ...m })), rulesets: rulesets.map((r, i) => ({ id: 100 + i, ...r })), issues: structuredClone(issues) }
  const writes = []
  const notFound = { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' }
  const ok = (body) => ({ status: 0, stdout: JSON.stringify(body ?? {}), stderr: '' })
  const page = (list, query) => {
    const p = Number(new URLSearchParams(query).get('page') ?? 1)
    return list.slice((p - 1) * 100, p * 100)
  }
  const run = (args, { input } = {}) => {
    const method = args[args.indexOf('--method') + 1]
    const [path, query = ''] = args[args.indexOf('--method') + 2].split('?')
    const body = input ? JSON.parse(input) : undefined
    const p = path.replace(`repos/${repo}`, '')
    if (method !== 'GET') writes.push(`${method} ${p}`)
    let m
    if (method === 'GET' && p === '') return ok({ default_branch: state.defaultBranch })
    if (method === 'PATCH' && p === '') { state.defaultBranch = body.default_branch; return ok({}) }
    if ((m = p.match(/^\/branches\/(.+)$/))) return state.branches[decodeURIComponent(m[1])] ? ok({ name: m[1] }) : notFound
    if ((m = p.match(/^\/git\/ref\/heads\/(.+)$/))) return state.branches[decodeURIComponent(m[1])] ? ok({ object: { sha: state.branches[decodeURIComponent(m[1])] } }) : notFound
    if (method === 'POST' && p === '/git/refs') { state.branches[body.ref.replace('refs/heads/', '')] = body.sha; return ok({}) }
    if (method === 'GET' && p === '/rulesets') return ok(state.rulesets.map(({ id, name }) => ({ id, name })))
    if ((m = p.match(/^\/rulesets\/(\d+)$/))) {
      const i = state.rulesets.findIndex((r) => r.id === Number(m[1]))
      if (method === 'GET') return i < 0 ? notFound : ok(state.rulesets[i])
      if (method === 'PUT') { state.rulesets[i] = { ...body, id: state.rulesets[i].id }; return ok(state.rulesets[i]) }
    }
    if (method === 'POST' && p === '/rulesets') { const r = { ...body, id: 100 + state.rulesets.length }; state.rulesets.push(r); return ok(r) }
    if (method === 'GET' && p === '/labels') return ok(page(state.labels, query))
    if (method === 'POST' && p === '/labels') { state.labels.push({ name: body.name, color: body.color, description: body.description }); return ok({}) }
    if ((m = p.match(/^\/labels\/(.+)$/)) && method === 'PATCH') {
      const name = decodeURIComponent(m[1])
      const l = state.labels.find((x) => x.name === name)
      if (!l) return notFound
      if (body.new_name) for (const iss of Object.values(state.issues)) iss.labels = iss.labels.map((x) => (x === name ? body.new_name : x))
      Object.assign(l, { name: body.new_name ?? l.name, color: body.color ?? l.color, description: body.description ?? l.description })
      return ok(l)
    }
    if (method === 'GET' && p === '/milestones') return ok(page(state.milestones.map((x) => ({ ...x })), query))
    if (method === 'POST' && p === '/milestones') { state.milestones.push({ number: state.milestones.length + 1, state: 'open', title: body.title, description: body.description }); return ok({}) }
    if ((m = p.match(/^\/milestones\/(\d+)$/)) && method === 'PATCH') { Object.assign(state.milestones.find((x) => x.number === Number(m[1])), body); return ok({}) }
    return { status: 1, stdout: '', stderr: `fake GitHub: no route for ${method} ${path}` }
  }
  return { run, state, writes }
}
