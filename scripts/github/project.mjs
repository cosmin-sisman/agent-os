// Creates or updates this repository's GitHub Project (v2): a public board linked to the repo, with
// Status, Priority and Size fields, every issue added, and fields synced from labels and issue state.
// Idempotent. Needs the `project` token scope. Usage: node scripts/github/project.mjs <owner/repo> [title]

import { execFileSync } from 'node:child_process'

const [repo, title = 'agent-os'] = process.argv.slice(2)
if (!repo?.includes('/')) { console.error('usage: project.mjs <owner/repo> [title]'); process.exit(2) }
const [owner, name] = repo.split('/')

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
// GitHub answers bursts of project mutations with "temporary conflict"; retry those with backoff.
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const gql = (query, vars = {}) => {
  const args = ['api', 'graphql', '-f', `query=${query}`]
  for (const [k, v] of Object.entries(vars)) args.push(typeof v === 'number' ? '-F' : '-f', `${k}=${v}`)
  for (let attempt = 1; ; attempt++) {
    try { return JSON.parse(gh(args)).data }
    catch (err) {
      if (attempt >= 6 || !/temporary conflict|try again|rate limit|secondary/i.test(String(err.stderr))) throw err
      sleep(500 * 2 ** attempt)
    }
  }
}

// 1. The project: find by title, else create; link it to the repository and make it public.
let project = JSON.parse(gh(['project', 'list', '--owner', owner, '--format', 'json', '--limit', '100'])).projects.find((p) => p.title === title)
if (!project) project = JSON.parse(gh(['project', 'create', '--owner', owner, '--title', title, '--format', 'json']))
const number = project.number
gh(['project', 'edit', String(number), '--owner', owner, '--visibility', 'PUBLIC',
  '--description', 'Roadmap and work in progress for agent-os: epics, milestones, priorities and sizes, synced from the repository.'])
try { gh(['project', 'link', String(number), '--owner', owner, '--repo', repo]) } catch {}

const pid = gql(`query($o:String!,$n:Int!){ user(login:$o){ projectV2(number:$n){ id } } }`, { o: owner, n: number }).user.projectV2.id

// 2. Single-select fields.
const fieldsQuery = `query($id:ID!){ node(id:$id){ ... on ProjectV2 { fields(first:50){ nodes{ ... on ProjectV2SingleSelectField { id name options { id name } } } } } } }`
const fields = () => Object.fromEntries(gql(fieldsQuery, { id: pid }).node.fields.nodes.filter((f) => f.name).map((f) => [f.name, f]))
const wanted = { Priority: ['P0', 'P1', 'P2', 'P3'], Size: ['S', 'M', 'L'] }
let f = fields()
for (const [fname, opts] of Object.entries(wanted)) {
  if (f[fname]) continue
  gh(['project', 'field-create', String(number), '--owner', owner, '--name', fname, '--data-type', 'SINGLE_SELECT', '--single-select-options', opts.join(',')])
}
f = fields()
const opt = (field, optionName) => f[field]?.options.find((o) => o.name === optionName)?.id

// 3. Every issue: add (idempotent) and sync Status, Priority, Size.
const issues = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'all', '--limit', '1000', '--json', 'id,number,state,labels,assignees']))
const setSelect = (item, field, optionId) => optionId && gql(
  `mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){ updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){ clientMutationId } }`,
  { p: pid, i: item, f: f[field].id, o: optionId })
let n = 0
for (const is of issues.sort((a, b) => a.number - b.number)) {
  const item = gql(`mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p,contentId:$c}){ item { id } } }`, { p: pid, c: is.id }).addProjectV2ItemById.item.id
  const labels = is.labels.map((l) => l.name)
  const status = is.state === 'CLOSED' ? 'Done' : is.assignees.length ? 'In Progress' : 'Todo'
  setSelect(item, 'Status', opt('Status', status))
  const pr = labels.find((l) => l.startsWith('priority:'))
  if (pr) setSelect(item, 'Priority', opt('Priority', pr.split(':')[1].toUpperCase()))
  const sz = labels.find((l) => l.startsWith('size:'))
  if (sz) setSelect(item, 'Size', opt('Size', sz.split(':')[1].toUpperCase()))
  n++
}
console.log(`project #${number} (${project.url ?? ''}): ${n} issues synced`)
