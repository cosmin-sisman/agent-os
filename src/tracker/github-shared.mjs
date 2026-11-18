// Shared by the GitHub adapter's modules: the "already done" answers, the issue shape and the checks rollup.

export const ALREADY = /already|duplicate sub-issues|already exists|has already been taken/i

/** An issue from the REST API, in the tracker's shape. */
export const issueOf = (i) => ({ number: i.number, title: i.title, state: i.state, url: i.html_url, labels: (i.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)), milestone: i.milestone ? { title: i.milestone.title, dueOn: i.milestone.due_on ?? null } : null, assignees: (i.assignees ?? []).map((a) => a.login), createdAt: i.created_at ?? null })

export const CONTEXTS = 'contexts(first:100){ nodes{ __typename ... on CheckRun { name status conclusion startedAt detailsUrl } ... on StatusContext { context state targetUrl createdAt } } }'

/**
 * The checks of a commit, one per name: the latest run wins, as for required checks. A re-run after a fix leaves the
 * old failed run on the same commit, and the platform's own rollup state still counts it. A run that has a
 * conclusion is finished, even when the API still reports it in progress (seen on GitHub after the job completed).
 */
export function checksOf(rollup) {
  const latest = new Map()
  for (const c of rollup?.contexts?.nodes ?? []) {
    const check = c.__typename === 'StatusContext'
      ? { name: c.context, at: c.createdAt ?? '', state: c.state === 'SUCCESS' ? 'success' : c.state === 'PENDING' || c.state === 'EXPECTED' ? 'pending' : 'failure', url: c.targetUrl ?? null }
      : { name: c.name, at: c.startedAt ?? '', state: !c.conclusion && c.status !== 'COMPLETED' ? 'pending' : ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(c.conclusion) ? 'success' : 'failure', url: c.detailsUrl ?? null }
    const seen = latest.get(check.name)
    if (!seen || check.at >= seen.at) latest.set(check.name, check)
  }
  const all = [...latest.values()].map(({ at, ...c }) => c)
  const overall = !all.length ? (rollup ? (rollup.state === 'SUCCESS' ? 'success' : rollup.state === 'PENDING' ? 'pending' : 'failure') : 'none') : all.some((c) => c.state === 'failure') ? 'failure' : all.some((c) => c.state === 'pending') ? 'pending' : 'success'
  return { overall, all }
}
