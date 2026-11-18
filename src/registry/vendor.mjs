// Vendored skills: third-party skills copied into .claude/skills/<name>/ at a pinned commit, recorded in the registry
// (origin external, source pinned) and in the lock (commit and a hash per file). Nothing from the fetched source is
// ever run: files are read and written as data, never executed, installed or evaluated. Vendored files are never
// edited; an update shows the diff between the two commits and replaces them only when confirmed.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { readLock, writeLock } from '../managed/managed.mjs'
import { registerSkill, readRegistry } from './registry.mjs'
import { ghClient } from '../tracker/gh.mjs'

const sha = (s) => createHash('sha256').update(s).digest('hex')
const MAX_FILE = 1024 * 1024

/** Parses github:owner/repo[/path]@ref or a local path. */
export function parseSource(source) {
  const gh = String(source).match(/^github:([\w.-]+)\/([\w.-]+)((?:\/[\w.-]+)*)@([\w./-]+)$/)
  if (gh) return { kind: 'remote', host: 'github', owner: gh[1], repo: gh[2], path: gh[3].replace(/^\//, ''), ref: gh[4] }
  if (/^(\.{1,2}\/|\/|[A-Za-z]:\\)/.test(source)) return { kind: 'local', path: source }
  throw new CliError(`"${source}" is not a skill source`, { hint: 'github:owner/repo[/path]@<commit, tag or branch>, or a local folder path' })
}

/**
 * Fetches a skill's files from GitHub through the gh client: the ref resolved to a commit, then the tree under the
 * path, then each blob. Only data is read.
 */
export function githubFetcher(gh) {
  return (src) => {
    const commit = gh.rest('GET', `repos/${src.owner}/${src.repo}/commits/${encodeURIComponent(src.ref)}`)?.sha
    if (!commit) throw new CliError(`${src.owner}/${src.repo}@${src.ref} was not found`)
    const tree = gh.rest('GET', `repos/${src.owner}/${src.repo}/git/trees/${commit}?recursive=1`)?.tree ?? []
    const prefix = src.path ? `${src.path}/` : ''
    const files = tree.filter((t) => t.type === 'blob' && t.mode !== '120000' && t.path.startsWith(prefix) && (t.size ?? 0) <= MAX_FILE).map((t) => {
      const blob = gh.rest('GET', `repos/${src.owner}/${src.repo}/git/blobs/${t.sha}`)
      return { path: t.path.slice(prefix.length), content: Buffer.from(blob.content ?? '', blob.encoding === 'base64' ? 'base64' : 'utf8') }
    })
    return { commit, files }
  }
}

/** Remote fetchers by source host; each reads data only. */
export const FETCHERS = { github: (io) => githubFetcher(ghClient(io.gh)) }

/** The fetcher for a source: a remote host's, or the local folder reader. */
export const fetcherFor = (io) => (src) => (src.kind === 'remote' ? FETCHERS[src.host](io)(src) : localFetcher()(src))

/** Reads a local folder as data. */
export function localFetcher() {
  return (src) => {
    const root = src.path
    if (!existsSync(join(root, 'SKILL.md'))) throw new CliError(`${root} has no SKILL.md`)
    const files = []
    const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.name === '.git' || e.name === 'node_modules') continue; const f = join(d, e.name); if (e.isDirectory()) walk(f); else if (statSync(f).size <= MAX_FILE) files.push({ path: relative(root, f).split('\\').join('/'), content: readFileSync(f) }) } }
    walk(root)
    return { commit: `local-${sha(files.map((f) => f.path + sha(f.content)).join('\n')).slice(0, 12)}`, files }
  }
}

const licenseOf = (files) => {
  const f = files.find((x) => /^(LICEN[CS]E|COPYING)(\.\w+)?$/i.test(x.path))
  if (!f) return null
  const t = f.content.toString('utf8')
  return /Apache License/i.test(t) ? 'Apache-2.0' : /MIT License|Permission is hereby granted, free of charge/i.test(t) ? 'MIT' : /BSD/i.test(t) ? 'BSD' : /GNU GENERAL PUBLIC LICENSE/i.test(t) ? 'GPL' : /Mozilla Public License/i.test(t) ? 'MPL-2.0' : 'see LICENSE'
}
const sourceString = (src, commit) => (src.kind === 'remote' ? `${src.host}:${src.owner}/${src.repo}${src.path ? `/${src.path}` : ''}@${commit}` : `local:${commit}`)
const folderOf = (name) => `.claude/skills/${name}`

function write(cwd, name, files) {
  const dir = join(cwd, folderOf(name))
  const targets = files.map((f) => {
    const target = join(dir, f.path)
    const rel = relative(dir, target)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new CliError(`the source holds a path outside its folder: ${f.path}`)
    return [target, f.content]
  })
  for (const [target, content] of targets) {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, { mode: 0o644 })
  }
}

/** Vendors a skill at its pinned commit. */
export function addSkill(cwd, { source, name, license, provides = [], fetch, dryRun = false }) {
  const src = parseSource(source)
  const got = fetch(src)
  if (!got.files.some((f) => f.path === 'SKILL.md')) throw new CliError('the source has no SKILL.md at its root', { hint: 'point at the folder that holds SKILL.md: github:owner/repo/path@ref' })
  const skillName = name ?? got.files.find((f) => f.path === 'SKILL.md').content.toString('utf8').match(/^name:\s*([a-z0-9][a-z0-9-]*)\s*$/m)?.[1]
  if (!skillName) throw new CliError('the skill has no name in its front matter', { hint: 'pass --name <name>' })
  if (existsSync(join(cwd, folderOf(skillName)))) throw new CliError(`${folderOf(skillName)} already exists`, { hint: `agent-os skill update ${skillName}, or remove it first` })
  const record = { source: sourceString(src, got.commit), ...(src.kind === 'remote' ? { ref: src.ref } : {}), folder: folderOf(skillName), commit: got.commit, files: Object.fromEntries(got.files.map((f) => [f.path, sha(f.content)])) }
  const lic = license ?? licenseOf(got.files)
  if (dryRun) return { dryRun: true, name: skillName, ...record, license: lic }
  write(cwd, skillName, got.files)
  registerSkill(cwd, { name: skillName, origin: src.kind === 'remote' ? 'external' : 'local', ...(src.kind === 'remote' ? { source: record.source } : {}), license: lic ?? undefined, provides })
  const lock = readLock(cwd)
  lock.vendored = { ...lock.vendored, [skillName]: record }
  writeLock(cwd, lock)
  return { name: skillName, ...record, license: lic }
}

/** A short line diff (changed lines only), per file, between two versions. */
export function diffFiles(before, after) {
  const out = []
  for (const path of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const a = before[path]
    const b = after[path]
    if (a === b) continue
    if (a === undefined) { out.push({ path, status: 'added', lines: b.split('\n').map((l) => `+${l}`) }); continue }
    if (b === undefined) { out.push({ path, status: 'removed', lines: a.split('\n').map((l) => `-${l}`) }); continue }
    const A = a.split('\n')
    const B = b.split('\n')
    const setB = new Set(B)
    const setA = new Set(A)
    out.push({ path, status: 'changed', lines: [...A.filter((l) => !setB.has(l)).map((l) => `-${l}`), ...B.filter((l) => !setA.has(l)).map((l) => `+${l}`)] })
  }
  return out
}

/** Updates a vendored skill: refuses local edits, shows the diff between commits, replaces only when confirmed. */
export function updateSkill(cwd, { name, ref, from, fetch, yes = false }) {
  const lock = readLock(cwd)
  const rec = lock.vendored?.[name]
  if (!rec) throw new CliError(`"${name}" is not a vendored skill`, { hint: 'agent-os skills lists them' })
  const dir = join(cwd, rec.folder)
  const edited = Object.entries(rec.files).filter(([p, h]) => !existsSync(join(dir, p)) || sha(readFileSync(join(dir, p))) !== h).map(([p]) => p)
  if (edited.length) throw new CliError(`vendored files were edited: ${edited.join(', ')}`, { hint: 'vendored skills are never edited in place: move the change into a local skill, then update' })
  let src
  if (from) src = parseSource(from)
  else if (rec.source.startsWith('local:')) throw new CliError(`${name} was vendored from a local folder`, { hint: `agent-os skill update ${name} --from <folder>` })
  else src = { ...parseSource(rec.source), ref: ref ?? rec.ref ?? parseSource(rec.source).ref }
  const got = fetch(src)
  if (got.commit === rec.commit) return { name, upToDate: true, commit: rec.commit }
  const before = Object.fromEntries(Object.keys(rec.files).map((p) => [p, readFileSync(join(dir, p), 'utf8')]))
  const after = Object.fromEntries(got.files.map((f) => [f.path, f.content.toString('utf8')]))
  const diff = diffFiles(before, after)
  if (!yes) return { name, from: rec.commit, to: got.commit, diff, written: false }
  if (!got.files.some((f) => f.path === 'SKILL.md')) throw new CliError('the new version has no SKILL.md at its root')
  for (const p of Object.keys(rec.files)) if (!after[p]) rmSync(join(dir, p), { force: true })
  write(cwd, name, got.files)
  const record = { ...rec, source: sourceString(src, got.commit), ...(src.kind === 'remote' ? { ref: src.ref } : {}), commit: got.commit, files: Object.fromEntries(got.files.map((f) => [f.path, sha(f.content)])) }
  lock.vendored = { ...lock.vendored, [name]: record }
  writeLock(cwd, lock)
  const entry = readRegistry(cwd).find((r) => r.entry?.name === name)?.entry
  if (entry?.origin === 'external') registerSkill(cwd, { ...entry, source: record.source }, { force: true })
  return { name, from: rec.commit, to: got.commit, diff, written: true }
}

/**
 * Removes a skill: the folder recorded in the lock (vendored) or its own folder (local), its registry entry, and
 * every slot bound to it in agent-os.json. Core skills are removed through agent-os eject, not here.
 */
export function removeSkill(cwd, { name, dryRun = false }) {
  const lock = readLock(cwd)
  const rec = lock.vendored?.[name]
  const entry = readRegistry(cwd).find((r) => r.entry?.name === name)
  if (entry?.entry?.origin === 'core') throw new CliError(`${name} is a core skill`, { hint: `agent-os eject .claude/skills/${name}/SKILL.md stops managing it` })
  if (!rec && !entry) throw new CliError(`no skill "${name}" is registered or vendored`)
  const folder = rec?.folder ?? (['plugin', 'builtin'].includes(entry?.entry?.origin) ? null : folderOf(name))
  const teamFile = join(cwd, 'agent-os.json')
  let team = null
  try { team = JSON.parse(readFileSync(teamFile, 'utf8')) } catch { team = null }
  const slots = Object.entries(team?.slots ?? {}).filter(([, v]) => v === name).map(([k]) => k)
  const steps = [...(folder ? [`delete ${folder}/`] : []), ...(entry ? [`delete ${entry.path}`] : []), ...(rec ? ['drop it from the lock'] : []), ...slots.map((s) => `unbind slot ${s} (set to null)`)]
  if (dryRun) return { dryRun: true, name, steps }
  if (folder) rmSync(join(cwd, folder), { recursive: true, force: true })
  if (entry) rmSync(join(cwd, entry.path), { force: true })
  if (rec) { const { [name]: _gone, ...rest } = lock.vendored; lock.vendored = rest; writeLock(cwd, lock) }
  if (slots.length) { for (const s of slots) team.slots[s] = null; writeFileSync(teamFile, `${JSON.stringify(team, null, 2)}\n`) }
  return { name, steps }
}

/** Scaffolds a local skill with its registry entry. */
export function newSkill(cwd, { name, description }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name ?? '')) throw new CliError('the name must be lowercase kebab-case')
  if (existsSync(join(cwd, folderOf(name)))) throw new CliError(`${folderOf(name)} already exists`)
  const desc = description ?? `What ${name} does, and when to use it.`
  mkdirSync(join(cwd, folderOf(name)), { recursive: true })
  writeFileSync(join(cwd, folderOf(name), 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n\n# /${name}\n\n## 1. …\n\n## Learn\n\nWhen this skill goes wrong, capture it with \`agent-os lessons add\`.\n`)
  return registerSkill(cwd, { name, origin: 'local' })
}

