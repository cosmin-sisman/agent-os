// Fixture repositories for the skill evals (#59), generated on the fly: nothing large or binary is committed. Each one
// is a real git repository with dated commits, so the profile detection, the release flow and the history-reading
// commands see what they would see in a project of that kind.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const DAY = 86_400_000

/** A git runner for a fixture: a fixed identity, no user config, no hooks, no signing. */
export function fixtureGit(cwd) {
  return (args, { date } = {}) => {
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Eval', GIT_AUTHOR_EMAIL: 'eval@example.invalid', GIT_COMMITTER_NAME: 'Eval', GIT_COMMITTER_EMAIL: 'eval@example.invalid', ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) }
    const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', env, windowsHide: true })
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }
}

const write = (cwd, files) => { for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(cwd, p)), { recursive: true }); writeFileSync(join(cwd, p), c) } }

/** Commits `files` at a date `daysAgo` before `now`. */
function commit(git, cwd, files, message, { now, daysAgo }) {
  write(cwd, files)
  git(['add', '-A'])
  git(['commit', '-q', '-m', message], { date: new Date(now.getTime() - daysAgo * DAY).toISOString() })
}

/**
 * The four repository states of design §11. `remote: true` adds an `origin` (a bare repository next to it) with
 * `main` and `development` pushed, for the flows that fetch.
 */
export function makeFixture(kind, { now = new Date(), remote = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), `aos-eval-${kind}-`))
  const cwd = join(root, 'repo')
  mkdirSync(cwd)
  const git = fixtureGit(cwd)
  git(['init', '-q', '-b', 'main'])
  if (kind === 'empty') {
    // A new repository: one commit, a README, no code.
    commit(git, cwd, { 'README.md': '# shop\n' }, 'chore: start', { now, daysAgo: 1 })
  } else if (kind === 'spec-only') {
    commit(git, cwd, { 'README.md': '# shop\n', 'docs/product.md': '# Product\n\n## Accounts\n\n- Sessions expire after 30 minutes of inactivity.\n', 'docs/security.md': '# Security\n\n## Sessions\n\n- Sessions expire after 15 minutes of inactivity.\n', 'docs/api.md': '# API\n\n## Orders\n\n- Customers can cancel an order before it ships.\n' }, 'docs: the specifications', { now, daysAgo: 3 })
  } else if (kind === 'active') {
    commit(git, cwd, { 'package.json': '{"name":"shop","version":"0.1.0"}\n', 'src/api/orders.ts': 'export const list = () => []\n', 'src/web/app.tsx': 'export const App = () => null\n', 'db/migrations/001_init.sql': 'CREATE TABLE orders (id int);\n' }, 'feat(api): first orders endpoint (#1)', { now, daysAgo: 40 })
    git(['tag', 'v0.1.0'])
    for (let i = 2; i <= 12; i++) commit(git, cwd, { [`src/api/f${i}.ts`]: `export const f${i} = ${i}\n` }, `${i % 3 ? 'feat' : 'fix'}(api): change ${i} (#${i})`, { now, daysAgo: 30 - i })
    // The destructive migration a release must ask about.
    commit(git, cwd, { 'db/migrations/002_drop_legacy.sql': 'DROP TABLE legacy_orders;\n' }, 'feat(db): drop the legacy orders table (#13)', { now, daysAgo: 2 })
  } else if (kind === 'maintenance') {
    commit(git, cwd, { 'package.json': '{"name":"shop","version":"2.3.0"}\n', 'src/index.js': 'module.exports = 1\n', 'CHANGELOG.md': '# 2.3.0\n' }, 'chore(release): 2.3.0', { now, daysAgo: 400 })
    git(['tag', 'v2.3.0'])
    commit(git, cwd, { 'src/index.js': 'module.exports = 2\n' }, 'fix: one last fix', { now, daysAgo: 300 })
  } else throw new Error(`unknown fixture "${kind}"`)
  if (remote) {
    const bare = join(root, 'origin.git')
    fixtureGit(root)(['init', '-q', '--bare', bare])
    git(['remote', 'add', 'origin', bare])
    // Production is the last release; integration is everything since.
    const tags = git(['tag', '--list']).stdout.trim().split(/\r?\n/).filter(Boolean)
    git(['branch', 'development'])
    git(['push', '-q', 'origin', 'development', '--tags'])
    git(['push', '-q', 'origin', `${tags.at(-1) ?? 'main'}^{commit}:refs/heads/main`])
    git(['fetch', '-q', 'origin'])
  }
  return { root, cwd, git }
}
