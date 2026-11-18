// `artifact link <id> <#N|!N>`: tells an issue or change request about an artifact with one comment. The link to the
// repository copy comes first (it is the source of truth), the published site second when the project has one. The
// comment is in the thread's language (ro without diacritics), and the ref is recorded in the artifact's metadata.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { toAscii } from '../i18n/i18n.mjs'
import { detectLanguage } from '../collab/thread.mjs'
import { DIR, listArtifacts } from './artifact.mjs'
import { webUrlOf } from './site.mjs'

/** The comment for an artifact, in a language: repository link first, site second. */
export function linkComment(a, { repoUrl, siteUrl, lang = 'en' }) {
  const words = lang === 'ro'
    ? { head: 'Artefact', repo: 'In repository', site: 'Publicat', status: 'stare' }
    : { head: 'Artifact', repo: 'In the repository', site: 'Published', status: 'status' }
  const lines = [
    `**${words.head}: ${a.title}** (${a.type}, ${words.status} ${a.status})`,
    '',
    a.summary,
    '',
    `- ${words.repo}: ${repoUrl}`,
    ...(siteUrl ? [`- ${words.site}: ${siteUrl}`] : []),
  ]
  const text = lines.join('\n')
  return lang === 'ro' ? toAscii(text) : text
}

/** Adds a ref to artifact.yaml's refs list (inline or block form) when it is not there yet. */
export function withRef(text, ref) {
  const m = text.match(/^refs:[ \t]*\[([^\]]*)\][ \t]*$/m)
  if (m) {
    const items = m[1].split(',').map((x) => x.trim()).filter(Boolean)
    if (items.some((x) => x.replace(/^["']|["']$/g, '') === ref)) return text
    return text.replace(m[0], `refs: [${[...items, JSON.stringify(ref)].join(', ')}]`)
  }
  if (/^refs:[ \t]*$/m.test(text)) return text.includes(`- "${ref}"`) || text.includes(`- '${ref}'`) ? text : text.replace(/^refs:[ \t]*$/m, `refs:\n  - ${JSON.stringify(ref)}`)
  return `${text.replace(/\s*$/, '')}\nrefs: [${JSON.stringify(ref)}]\n`
}

/**
 * Plans and posts the comment. The language follows the thread (its comments, else its body), else the area's
 * language for that kind of item.
 */
export function linkArtifact(cwd, { tracker, config, vocab }, { id, target, dryRun = false, fallbackLang = 'en' }) {
  const a = listArtifacts(cwd).find((x) => x.folder === id)
  if (!a) throw new CliError(`no artifact "${id}"`, { hint: 'agent-os artifact list' })
  if (a.problems.length) throw new CliError(`${DIR}/${id}/artifact.yaml has problems: ${a.problems.join('; ')}`, { hint: 'agent-os artifact check' })
  const m = String(target).match(/^([#!])?(\d+)$/)
  if (!m) throw new CliError(`"${target}" is not an issue (#N) or change request (!N)`)
  const n = Number(m[2])
  const changeRequest = m[1] === '!'
  const web = webUrlOf(config)
  if (!web) throw new CliError('platform.project is not set, so there is no repository link', { hint: 'agent-os platform detect --write' })
  const repoUrl = `${web}/${vocab.treePath}/${config.branches.integration}/${DIR}/${id}`
  const siteUrl = config.artifacts?.siteUrl ? `${config.artifacts.siteUrl.replace(/\/+$/, '')}/${id}/` : null
  let texts = []
  try {
    texts = (tracker.comments?.(n, { changeRequest }) ?? []).filter((c) => !c.bot).map((c) => c.body)
    if (!texts.length && !changeRequest) texts = [tracker.get(n)?.body ?? '']
  } catch { texts = [] }
  const langs = texts.map(detectLanguage).filter(Boolean)
  const lang = langs.length ? langs.at(-1) : fallbackLang
  const body = linkComment(a, { repoUrl, siteUrl, lang })
  const ref = `${changeRequest ? '!' : '#'}${n}`
  const file = join(cwd, DIR, id, 'artifact.yaml')
  const meta = withRef(readFileSync(file, 'utf8'), ref)
  if (!dryRun) {
    if (changeRequest) tracker.commentChangeRequest(n, body)
    else tracker.comment(n, body)
    writeFileSync(file, meta)
  }
  return { id, target: ref, lang, body, repoUrl, siteUrl, dryRun }
}
