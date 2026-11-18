// Tests for `agent-os install`, the one-command start: the bare command starts it on a terminal and prints help
// elsewhere; it offers git init, asks the platform and project when there is no origin, creates the repository
// (private) only after a yes, writes the personal settings and ends with what to do next; --yes stays scripted.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'aos-install-')))
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' })

/** A terminal that answers each question by the first rule whose pattern matches it, and records the questions. */
function terminal(rules) {
  const asked = []
  const ask = async (text) => {
    asked.push(text)
    const rule = rules.find(([re]) => re.test(text))
    if (!rule) throw new Error(`unexpected question: ${text}`)
    return rule[1]
  }
  return { ask, asked }
}

/** A gh that knows the login and records every call; `repo create` succeeds. */
function fakeGh(login = 'ana') {
  const calls = []
  const gh = (args, opts = {}) => {
    calls.push({ args, opts })
    if (args[0] === 'api' && args[1] === 'user') return { status: 0, stdout: `${login}\n`, stderr: '' }
    if (args[0] === 'repo' && args[1] === 'create') return { status: 0, stdout: `https://github.com/${args[2]}\n`, stderr: '' }
    return { status: 1, stdout: '', stderr: 'offline in tests' }
  }
  return { gh, calls }
}

async function cli(cwd, argv, extra = {}) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {}, running: '0.0.0', ...extra })
  return { code, stdout, stderr }
}

const BASE = [[/talk to you/, 'en'], [/Integration branch/, ''], [/Which profile/, ''], [/Language of the team areas/, 'en'], [/several people/, 'n'], [/Write this\?/, 'y'], [/How many agent sessions/, '1'], [/free memory/, ''], [/is not installed on this laptop/, 'n'], [/Nothing is committed yet/, 'n']]

test('on a terminal, the bare command in a folder without agent-os.json starts install; elsewhere it prints help and asks nothing', async () => {
  const cwd = tmp()
  try {
    const t = terminal([[/talk to you/, 'en'], [/Integration branch/, ''], [/not a git repository/, 'n']])
    const r = await cli(cwd, [], { ask: t.ask })
    assert.equal(r.code, 2)
    assert.match(t.asked[0], /Which language should the agent talk to you in/)
    assert.match(r.stderr, /agent-os needs a git repository[\s\S]*git init -b development/)
    assert.equal(existsSync(join(cwd, '.git')), false, 'no means no')
    const plain = await cli(cwd, [])
    assert.equal(plain.code, 0)
    assert.match(plain.stdout, /^ {2}install {6}Start in any folder/m, 'help, which lists install')
    assert.equal(existsSync(join(cwd, 'agent-os.json')), false)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('given a fresh folder, install runs git init and adds an existing project as origin, then init, the personal settings and the next steps', async () => {
  const cwd = tmp()
  try {
    const { gh, calls } = fakeGh()
    const t = terminal([[/not a git repository. Run git init -b development/, 'y'], [/Which platform/, 'github'], [/Self-managed host/, ''], [/Create a new private repository/, 'n'], [/as owner\/name/, 'acme/shop'], ...BASE])
    const r = await cli(cwd, ['install'], { ask: t.ask, gh })
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.equal(git(cwd, 'symbolic-ref', '--short', 'HEAD').stdout.trim(), 'development')
    assert.equal(git(cwd, 'remote', 'get-url', 'origin').stdout.trim(), 'https://github.com/acme/shop.git')
    assert.equal(calls.some((c) => c.args[0] === 'repo'), false, 'nothing created on the platform')
    assert.deepEqual(JSON.parse(readFileSync(join(cwd, 'agent-os.json'), 'utf8')).platform, { type: 'github', project: 'acme/shop' })
    const local = JSON.parse(readFileSync(join(cwd, '.agent-os/local.json'), 'utf8'))
    assert.deepEqual([local.languages.chat, local.machine.maxWorkers], ['en', 1])
    assert.match(r.stdout, /^git init -b development\nadded origin https:\/\/github\.com\/acme\/shop\.git\n/)
    assert.match(r.stdout, /wrote \.agent-os\/local\.json: chat en, 1 session\(s\)/)
    assert.match(r.stdout, /Next:\n {2}1\. open Claude Code in this folder \(claude\)\n {2}2\. \/kickoff[\s\S]*agent-os doctor[\s\S]*\/next/)
    assert.equal(t.asked.filter((q) => /talk to you/.test(q)).length, 1, 'the chat language is asked once')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('with no origin, install creates the private repository only after a yes, and a no creates nothing', async () => {
  const cwd = tmp()
  try {
    git(cwd, 'init', '-q', '-b', 'development')
    const no = fakeGh()
    const refused = await cli(cwd, ['install'], { gh: no.gh, ask: terminal([[/talk to you/, 'en'], [/Which platform/, ''], [/Self-managed host/, ''], [/Create a new private repository/, 'y'], [/as owner\/name/, ''], [/with gh repo create/, '']]).ask })
    assert.equal(refused.code, 2)
    assert.match(refused.stderr, /nothing was created/)
    assert.equal(no.calls.some((c) => c.args[0] === 'repo'), false, 'the default answer is no')

    const yes = fakeGh()
    const t = terminal([[/Which platform/, ''], [/Self-managed host/, ''], [/Create a new private repository/, 'y'], [/as owner\/name/, ''], [/Create the private repository github\.com\/ana\/aos-install-\w+ with gh repo create/, 'y'], ...BASE])
    const r = await cli(cwd, ['install'], { gh: yes.gh, ask: t.ask })
    assert.equal(r.code, 0, r.stdout + r.stderr)
    const create = yes.calls.find((c) => c.args[0] === 'repo')
    assert.deepEqual(create.args.slice(0, 4), ['repo', 'create', `ana/${cwd.split(/[\\/]/).pop()}`, '--private'])
    assert.deepEqual(create.args.slice(4), ['--source', cwd, '--remote', 'origin'])
    assert.match(r.stdout, /created the private repository github\.com\/ana\/aos-install-\w+\n/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('on GitLab self-managed, the host goes to glab, and origin is added when glab did not set it', async () => {
  const cwd = tmp()
  try {
    git(cwd, 'init', '-q', '-b', 'development')
    const calls = []
    const glab = (args, opts = {}) => {
      calls.push({ args, opts })
      if (args[0] === 'api' && args[1] === 'user') return { status: 0, stdout: '{"username":"ana"}', stderr: '' }
      if (args[0] === 'repo') return { status: 0, stdout: '', stderr: '' }
      return { status: 1, stdout: '', stderr: 'offline in tests' }
    }
    const t = terminal([[/Which platform/, 'gitlab'], [/Self-managed host/, 'https://git.acme.example'], [/Create a new private repository on git\.acme\.example/, 'y'], [/as owner\/name/, 'team/shop'], [/with glab repo create/, 'y'], ...BASE])
    const r = await cli(cwd, ['install'], { glab, gh: fakeGh().gh, ask: t.ask })
    assert.equal(r.code, 0, r.stdout + r.stderr)
    const create = calls.find((c) => c.args[0] === 'repo')
    assert.deepEqual([create.args, create.opts.env], [['repo', 'create', 'team/shop', '--private'], { GITLAB_HOST: 'git.acme.example' }])
    assert.equal(git(cwd, 'remote', 'get-url', 'origin').stdout.trim(), 'https://git.acme.example/team/shop.git')
    assert.deepEqual(JSON.parse(readFileSync(join(cwd, 'agent-os.json'), 'utf8')).platform, { type: 'gitlab', project: 'team/shop', host: 'https://git.acme.example' })
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('scripted: --yes without a remote or --platform fails with the hint and writes nothing; with flags it runs end to end', async () => {
  const cwd = tmp()
  try {
    const r = await cli(cwd, ['install', '--yes'], { ask: async (q) => { throw new Error(`asked: ${q}`) } })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /there is no origin remote\n {2}hint: pass --platform github\|gitlab --project <owner\/name>/)
    assert.equal(existsSync(join(cwd, '.git')), false)
    const ok = await cli(cwd, ['install', '--platform', 'github', '--project', 'acme/shop', '--lang', 'en', '--chat', 'ro', '--solo', '--yes'], { gh: fakeGh().gh })
    assert.equal(ok.code, 0, ok.stdout + ok.stderr)
    assert.match(ok.stdout, /^git init -b development\n/)
    assert.equal(JSON.parse(readFileSync(join(cwd, '.agent-os/local.json'), 'utf8')).languages.chat, 'ro')
    assert.match(ok.stdout, /Next:/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('a fresh folder gets the CLI and the first commit only after a yes: npm i -g with the pinned version, then commit and push', async () => {
  const cwd = tmp()
  const remote = tmp()
  try {
    const env = { ...process.env, GIT_AUTHOR_NAME: 'Ana', GIT_AUTHOR_EMAIL: 'ana@example.com', GIT_COMMITTER_NAME: 'Ana', GIT_COMMITTER_EMAIL: 'ana@example.com' }
    const g = (args) => { const r = spawnSync('git', args, { cwd, env, encoding: 'utf8' }); return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' } }
    g(['init', '-q', '-b', 'development'])
    spawnSync('git', ['init', '-q', '--bare'], { cwd: remote })
    g(['remote', 'add', 'origin', remote])
    const npm = []
    const rules = [[/is not installed on this laptop. Install it now \(npm i -g @cosmin-sisman\/agent-os@0\.0\.0\)/, 'y'], [/Commit the installed files as the first commit on development/, 'y'], ...BASE.filter(([re]) => !/not installed|committed/.test(re.source))]
    const r = await cli(cwd, ['install', '--platform', 'github', '--project', 'acme/shop'], { ask: terminal(rules).ask, gh: fakeGh().gh, git: g, npm: (args) => { npm.push(args); return { status: 0, stdout: '', stderr: '' } } })
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.deepEqual(npm, [['install', '--global', '@cosmin-sisman/agent-os@0.0.0']])
    assert.match(r.stdout, /installed the agent-os command \(npm i -g @cosmin-sisman\/agent-os@0\.0\.0\)\ncommitted the installed files on development \(chore: install agent-os\)\npushed development to origin\n/)
    const files = g(['show', '--name-only', '--format=%s', 'HEAD']).stdout.trim().split('\n')
    assert.equal(files[0], 'chore: install agent-os')
    assert.ok(files.includes('agent-os.json') && files.includes('AGENTS.md') && files.includes('.claude/skills/next/SKILL.md'))
    assert.ok(!files.includes('.agent-os/local.json'), 'personal settings stay out')
    assert.equal(spawnSync('git', ['--git-dir', remote, 'log', '--format=%s', 'development'], { encoding: 'utf8' }).stdout.trim(), 'chore: install agent-os')
  } finally { rmSync(cwd, { recursive: true, force: true }); rmSync(remote, { recursive: true, force: true }) }
})

test('without a terminal and without --yes, install only says how: no npm, no commit', async () => {
  const cwd = tmp()
  try {
    git(cwd, 'init', '-q', '-b', 'development')
    let npm = 0
    const r = await cli(cwd, ['install', '--platform', 'github', '--project', 'acme/shop', '--lang', 'en', '--chat', 'en', '--solo'], { gh: fakeGh().gh, npm: () => { npm++; return { status: 0 } } })
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.equal(npm, 0)
    assert.match(r.stdout, /the agent-os command is not on this PATH: npm i -g @cosmin-sisman\/agent-os@0\.0\.0 installs it; until then, run npx -y @cosmin-sisman\/agent-os@0\.0\.0 <command>/)
    assert.match(r.stdout, /not committed yet: git add <the installed files> && git commit -m "chore: install agent-os" && git push -u origin development/)
    assert.notEqual(git(cwd, 'rev-parse', '--verify', '--quiet', 'HEAD').status, 0)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
