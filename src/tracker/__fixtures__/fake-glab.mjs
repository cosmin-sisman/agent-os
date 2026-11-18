// Test helper: a fake `glab` that answers `glab api` calls from a route table and records every call with its JSON
// input. Routes are keyed "METHOD path" (a trailing * matches any rest of the key) and "graphql:<first word after the
// first brace>"; a function value receives the parsed input and the call count and returns { status?, stdout?,
// stderr? } or a JSON-able body (GraphQL bodies are wrapped in { data } like the real API does).

export function fakeGlab(routes = {}) {
  const calls = []
  const run = (args, { input } = {}) => {
    const body = input ? JSON.parse(input) : undefined
    const method = args[args.indexOf('--method') + 1]
    const path = args[args.indexOf('--method') + 2]
    const key = path === 'graphql' ? `graphql:${body.query.match(/\{\s*(\w+)/)[1]}` : `${method} ${path}`
    calls.push({ key, args, body })
    let r = routes[key] ?? Object.entries(routes).find(([k]) => k.endsWith('*') && key.startsWith(k.slice(0, -1)))?.[1]
    if (typeof r === 'function') r = r(body, calls.filter((c) => c.key === key).length)
    if (r === undefined) return { status: 1, stdout: '', stderr: `glab: 404 Not Found (HTTP 404) fake glab: no route for ${key}` }
    if (r && typeof r === 'object' && 'status' in r && Object.keys(r).every((k) => ['status', 'stdout', 'stderr'].includes(k))) return { stdout: '', stderr: '', ...r }
    return { status: 0, stdout: JSON.stringify(key.startsWith('graphql:') ? { data: r } : r), stderr: '' }
  }
  run.calls = calls
  return run
}
