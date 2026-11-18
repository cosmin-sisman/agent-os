// Test helper: a fake network for platform probes.

/** A fake fetch: routes by URL to { status, body, headers }; anything else is a DNS failure. */
export function fakeFetch(routes) {
  const calls = []
  const fn = async (url) => {
    calls.push(url)
    const r = routes[url]
    if (!r) { const err = new TypeError('fetch failed'); err.cause = { code: 'ENOTFOUND' }; throw err }
    return { status: r.status, headers: new Headers(r.headers ?? {}), json: async () => { if (r.body === undefined) throw new SyntaxError('not json'); return r.body } }
  }
  fn.calls = calls
  return fn
}
