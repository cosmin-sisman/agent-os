// Test helper: a fake `gh` that answers `gh api` calls from a route table and records every call with its JSON input.
// Routes are keyed "METHOD path" for REST (a trailing * matches any rest of the key) and "graphql:<first word after the brace>" for GraphQL; a function value
// receives the parsed input and returns { status?, stdout?, stderr? } or a JSON-able body (GraphQL bodies are wrapped in
// { data } like the real gh does).

export function fakeGh(routes = {}) {
  const calls = []
  const run = (args, { input } = {}) => {
    const body = input ? JSON.parse(input) : undefined
    let key
    if (args[0] === 'api' && args[1] === 'graphql') key = `graphql:${body.query.match(/\{\s*(\w+)/)[1]}`
    else if (args[0] === 'api') key = `${args[args.indexOf('--method') + 1]} ${args[args.indexOf('--method') + 2]}`
    else key = args.slice(0, 2).join(' ')
    calls.push({ key, args, body })
    let r = routes[key] ?? Object.entries(routes).find(([k]) => k.endsWith('*') && key.startsWith(k.slice(0, -1)))?.[1]
    if (typeof r === 'function') r = r(body, calls.filter((c) => c.key === key).length)
    if (r === undefined) return { status: 1, stdout: '', stderr: `fake gh: no route for ${key}` }
    if (r && typeof r === 'object' && 'status' in r) return { stdout: '', stderr: '', ...r }
    return { status: 0, stdout: JSON.stringify(key.startsWith('graphql:') ? { data: r } : r), stderr: '' }
  }
  run.calls = calls
  return run
}
