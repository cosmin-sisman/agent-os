// The CI reviewer behind /ci: reads GitHub Actions workflows and GitLab CI files and reports what best practice asks
// for. Least-privilege permissions, pinned actions and images, timeouts, concurrency, no untrusted input expanded into
// scripts, pull_request_target rules, credentials not persisted, rules instead of only/except. It only reads.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '../yaml/yaml.mjs'

/** The checklist, one line per rule: what /ci writes and what the review checks. */
export const RULES = {
  'gh-permissions': { level: 'error', text: 'top-level `permissions:` with the least it needs (contents: read), widened per job; never write-all' },
  'gh-pin-actions': { level: 'error', text: 'third-party actions pinned to a full commit SHA, with the version in a comment' },
  'gh-injection': { level: 'error', text: 'no untrusted input (titles, bodies, branch names, commit messages) in `${{ }}` inside `run:`; pass it through `env:`' },
  'gh-pr-target': { level: 'error', text: '`pull_request_target` never checks out or runs the pull request\'s code' },
  'gh-timeout': { level: 'warn', text: 'every job has `timeout-minutes`' },
  'gh-concurrency': { level: 'warn', text: 'pull request workflows set `concurrency` with cancel-in-progress' },
  'gh-persist-credentials': { level: 'warn', text: '`actions/checkout` with `persist-credentials: false` unless a later step pushes' },
  'gh-secrets-in-run': { level: 'warn', text: 'secrets reach scripts through `env:`, not `${{ secrets.X }}` inside `run:`' },
  'gh-oidc': { level: 'info', text: 'cloud credentials through OIDC (`id-token: write` on the job that needs it), not long-lived secrets' },
  'gl-rules': { level: 'error', text: '`rules:` instead of `only:`/`except:`' },
  'gl-image-tag': { level: 'error', text: 'images name a version (or a digest), never latest or no tag' },
  'gl-include-ref': { level: 'error', text: '`include: project` pins a `ref`; `include: remote` is avoided' },
  'gl-injection': { level: 'error', text: 'untrusted variables ($CI_MERGE_REQUEST_TITLE, $CI_COMMIT_MESSAGE, …) are never evaluated in a script (eval, unquoted, sh -c)' },
  'gl-timeout': { level: 'warn', text: 'every job has `timeout:`' },
  'gl-interruptible': { level: 'info', text: 'merge request jobs are `interruptible: true`' },
  'gl-image-digest': { level: 'info', text: 'images pinned by digest where the registry allows it' },
  'lint': { level: 'info', text: 'run actionlint (GitHub) or `glab ci lint` (GitLab) before pushing' },
}

const UNTRUSTED_GH = /\$\{\{\s*(github\.event\.(issue|pull_request|comment|review|review_comment|discussion|discussion_comment|pages|commits|head_commit|workflow_run)[\w.[\]*'-]*\.(title|body|message|name|email|label|ref|head_ref|default_branch|page_name)|github\.head_ref|github\.event\.pull_request\.head\.(ref|label|repo\.full_name)|github\.event\.head_commit\.(message|author\.(name|email))|inputs\.[\w-]+)\s*\}\}/
const UNTRUSTED_GL = /\$\{?(CI_MERGE_REQUEST_TITLE|CI_MERGE_REQUEST_DESCRIPTION|CI_COMMIT_MESSAGE|CI_COMMIT_TITLE|CI_COMMIT_DESCRIPTION|CI_COMMIT_REF_NAME|CI_COMMIT_BRANCH|CI_MERGE_REQUEST_SOURCE_BRANCH_NAME|CI_COMMIT_AUTHOR)\}?/
const SHA = /@[0-9a-f]{40}$/

const finding = (file, rule, where, detail) => ({ file, rule, level: RULES[rule].level, where, message: detail ?? RULES[rule].text })
const asList = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v])
const lines = (v) => asList(v).flatMap((x) => String(x).split('\n'))

/** Review one GitHub Actions workflow. */
export function reviewGitHub(doc, file) {
  const out = []
  const on = doc.on ?? doc.true ?? {}
  const events = typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {})
  if (doc.permissions === undefined) out.push(finding(file, 'gh-permissions', 'workflow', 'no top-level `permissions:`; the token gets the repository default, often write'))
  else if (doc.permissions === 'write-all') out.push(finding(file, 'gh-permissions', 'workflow', '`permissions: write-all`'))
  if (events.some((e) => ['pull_request', 'pull_request_target'].includes(e)) && !doc.concurrency) out.push(finding(file, 'gh-concurrency', 'workflow'))
  for (const [id, job] of Object.entries(doc.jobs ?? {})) {
    const at = `jobs.${id}`
    if (job?.permissions === 'write-all') out.push(finding(file, 'gh-permissions', at, '`permissions: write-all`'))
    if (job?.uses) { if (!/^\.\//.test(job.uses) && !SHA.test(job.uses)) out.push(finding(file, 'gh-pin-actions', at, `reusable workflow ${job.uses} is not pinned to a commit SHA`)); continue }
    if (job?.['timeout-minutes'] === undefined) out.push(finding(file, 'gh-timeout', at))
    asList(job?.steps).forEach((step, i) => {
      const s = `${at}.steps[${i}]${step?.name ? ` (${step.name})` : ''}`
      if (step?.uses && !/^(\.\/|docker:\/\/.+@sha256:)/.test(step.uses) && !SHA.test(step.uses)) out.push(finding(file, 'gh-pin-actions', s, `${step.uses} is not pinned to a commit SHA`))
      if (/^actions\/checkout@/.test(step?.uses ?? '')) {
        if (step.with?.['persist-credentials'] !== false && step.with?.['persist-credentials'] !== 'false') out.push(finding(file, 'gh-persist-credentials', s))
        if (events.includes('pull_request_target') && /github\.event\.pull_request\.head|github\.head_ref|refs\/pull/.test(JSON.stringify(step.with ?? {}))) out.push(finding(file, 'gh-pr-target', s, 'pull_request_target checks out the pull request\'s head: its code runs with the base repository\'s secrets'))
      }
      for (const l of lines(step?.run)) {
        const m = l.match(UNTRUSTED_GH)
        if (m) out.push(finding(file, 'gh-injection', s, `\`${m[0]}\` is expanded into the script: script injection; set it in \`env:\` and use "$VAR"`))
        if (/\$\{\{\s*secrets\./.test(l)) out.push(finding(file, 'gh-secrets-in-run', s))
      }
    })
  }
  return out
}

const RESERVED = new Set(['stages', 'variables', 'default', 'include', 'workflow', 'image', 'services', 'cache', 'before_script', 'after_script', 'spec'])

/** Review one GitLab CI file. */
export function reviewGitLab(doc, file) {
  const out = []
  const imageOf = (img) => (typeof img === 'string' ? img : img?.name ?? null)
  const checkImage = (img, at) => {
    const name = imageOf(img)
    if (!name || name.includes('$')) return
    if (/@sha256:[0-9a-f]{64}$/.test(name)) return
    const tag = name.split('/').pop().split(':')[1]
    if (!tag || tag === 'latest') out.push(finding(file, 'gl-image-tag', at, `image ${name} has no version`))
    else out.push(finding(file, 'gl-image-digest', at, `image ${name} is pinned by tag, not digest`))
  }
  checkImage(doc.image ?? doc.default?.image, 'default')
  for (const inc of asList(doc.include)) {
    if (inc?.remote) out.push(finding(file, 'gl-include-ref', 'include', `include: remote ${inc.remote} can change under you`))
    if (inc?.project && !inc.ref) out.push(finding(file, 'gl-include-ref', 'include', `include: project ${inc.project} has no ref`))
  }
  for (const [id, job] of Object.entries(doc)) {
    if (RESERVED.has(id) || id.startsWith('.') || !job || typeof job !== 'object' || Array.isArray(job)) continue
    if (!job.script && !job.trigger && !job.extends) continue
    const at = id
    if (job.only !== undefined || job.except !== undefined) out.push(finding(file, 'gl-rules', at))
    checkImage(job.image, at)
    if (job.timeout === undefined && doc.default?.timeout === undefined && !job.trigger) out.push(finding(file, 'gl-timeout', at))
    if (JSON.stringify(job.rules ?? '').includes('merge_request_event') && job.interruptible !== true && doc.default?.interruptible !== true) out.push(finding(file, 'gl-interruptible', at))
    for (const l of [...lines(job.before_script), ...lines(job.script), ...lines(job.after_script)]) {
      const m = l.match(UNTRUSTED_GL)
      if (!m) continue
      const quoted = new RegExp(`"[^"]*\\$\\{?${m[1]}\\}?[^"]*"`).test(l)
      if (/\beval\b|\bsh -c\b|\bbash -c\b/.test(l) || !quoted) out.push(finding(file, 'gl-injection', at, `$${m[1]} is ${/\beval\b|-c\b/.test(l) ? 'evaluated' : 'unquoted'} in a script line; quote it ("$${m[1]}") and never eval it`))
    }
  }
  return out
}

/** The kind of CI file a path is, or null. */
export function kindOf(path) {
  const p = path.replace(/\\/g, '/')
  if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(p)) return 'github'
  if (/(^|\/)\.gitlab-ci\.ya?ml$/.test(p) || /(^|\/)\.gitlab\/.+\.ya?ml$/.test(p)) return 'gitlab'
  return null
}

const REVIEWERS = { github: reviewGitHub, gitlab: reviewGitLab }

/** Reviews a CI file's text. A file that cannot be parsed is one error finding. */
export function reviewText(text, file, kind = kindOf(file)) {
  if (!kind) return [{ file, rule: 'lint', level: 'error', where: 'file', message: 'not a GitHub Actions workflow or a GitLab CI file' }]
  let doc
  try { doc = parse(text, { file }) } catch (err) { return [{ file, rule: 'lint', level: 'error', where: 'file', message: `could not be read: ${err.message}` }] }
  return REVIEWERS[kind](doc ?? {}, file)
}

/** The CI files of a repository. */
export function ciFiles(cwd) {
  const out = []
  const wf = join(cwd, '.github', 'workflows')
  if (existsSync(wf)) for (const f of readdirSync(wf).sort()) if (/\.ya?ml$/.test(f)) out.push(`.github/workflows/${f}`)
  for (const f of ['.gitlab-ci.yml', '.gitlab-ci.yaml']) if (existsSync(join(cwd, f))) out.push(f)
  const gl = join(cwd, '.gitlab')
  if (existsSync(gl)) for (const f of readdirSync(gl).sort()) if (/\.ya?ml$/.test(f)) out.push(`.gitlab/${f}`)
  return out
}

/** Reviews files of a repository (all of them by default); errors fail, warnings and info do not. */
export function reviewRepo(cwd, files = ciFiles(cwd)) {
  const findings = files.flatMap((f) => reviewText(readFileSync(join(cwd, f), 'utf8'), f))
  const count = (l) => findings.filter((x) => x.level === l).length
  return { files, findings, summary: { error: count('error'), warn: count('warn'), info: count('info') } }
}
