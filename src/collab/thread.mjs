// Comment-driven work: read the conversation on an issue or change request before acting. It finds the decisions
// made in comments (quoted verbatim, never paraphrased), the language each comment is in (a reply answers in it, ro
// without diacritics), and the people taking part, so a reply @mentions only real participants.

import { findDiacritics, toAscii } from '../i18n/i18n.mjs'

// A decision is a paragraph that says so: "Decision: …", "Decided: …", "Decizie: …", "We decided …", "Am decis …".
const DECISION = /^\s*(?:[-*>]\s*)?(?:\*\*|__)?(?:decision|decided|agreed|decizie|decis|hotarat|hotarare)(?:\*\*|__)?\s*[:-]|\b(?:we (?:have )?decided|we agreed|let'?s go with|we(?:'ll| will) go with|am (?:decis|hotarat|stabilit)|ramane (?:asa|stabilit)|mergem pe)\b/i

const RO = new Set(['si', 'este', 'sunt', 'nu', 'pentru', 'care', 'sa', 'cu', 'la', 'din', 'mai', 'ca', 'dar', 'acest', 'aceasta', 'trebuie', 'poate', 'doar', 'inca', 'fost', 'avem', 'facem', 'bine', 'asa', 'acum', 'daca', 'unde', 'cand', 'vrem', 'putem', 'aici', 'te', 'rog', 'multumesc', 'eu', 'noi', 'el', 'ea', 'un', 'o', 'lui', 'sau', 'fie', 'peste', 'dupa', 'inainte'])
const EN = new Set(['the', 'is', 'are', 'and', 'for', 'this', 'that', 'with', 'should', 'not', 'can', 'we', 'it', 'be', 'of', 'to', 'in', 'on', 'please', 'thanks', 'would', 'could', 'have', 'has', 'what', 'why', 'when', 'where', 'you', 'i', 'a', 'an', 'but', 'or', 'if', 'do', 'does', 'will'])

/** The language of a text, 'ro' or 'en', or null when it gives no signal (code, a link, an emoji). */
export function detectLanguage(text) {
  const prose = String(text ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/^>.*$/gm, ' ')
  if (findDiacritics(prose).length) return 'ro'
  let ro = 0
  let en = 0
  for (const w of toAscii(prose).toLowerCase().match(/[a-z']+/g) ?? []) { if (RO.has(w)) ro++; if (EN.has(w)) en++ }
  if (ro + en < 2) return null
  return ro > en ? 'ro' : 'en'
}

/** The decisions in a comment body: each paragraph that states one, verbatim. */
export function decisionsIn(body) {
  return String(body ?? '').replace(/```[\s\S]*?```/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && p.split('\n').some((l) => DECISION.test(l)))
}

/**
 * Everything a skill needs before acting on an item: its comments (and review threads for a change request), the
 * decisions with who made them and when, the participants and the conversation's language.
 */
export function readThread(tracker, number, { changeRequest = false } = {}) {
  const item = changeRequest ? null : tracker.get(number)
  const isCr = changeRequest || Boolean(item?.isPullRequest)
  const cr = isCr ? tracker.pullRequestStatus(number) : null
  const comments = tracker.comments(number, { changeRequest: isCr })
  const reviews = isCr && tracker.reviewThreads ? tracker.reviewThreads(number) : []
  const all = [
    { author: cr?.author ?? null, body: (cr ?? item)?.body ?? '', at: null, url: (cr ?? item)?.url ?? null, source: 'description' },
    ...comments.map((c) => ({ ...c, source: 'comment' })),
    ...reviews.flatMap((t) => t.comments.map((c) => ({ ...c, source: 'review', thread: t.id, path: t.path, resolved: t.resolved }))),
  ]
  const human = all.filter((c) => !c.bot && c.source !== 'description')
  const decisions = all.filter((c) => !c.bot).flatMap((c) => decisionsIn(c.body).map((text) => ({ text, author: c.author, at: c.at, url: c.url, source: c.source })))
  const participants = [...new Set([cr?.author, ...(item?.assignees ?? []), ...all.filter((c) => !c.bot).map((c) => c.author)].filter(Boolean))].sort()
  const langs = human.map((c) => detectLanguage(c.body)).filter(Boolean)
  const language = langs.length ? (langs.filter((l) => l === 'ro').length > langs.length / 2 ? 'ro' : 'en') : null
  return {
    number, kind: isCr ? 'change-request' : 'issue', title: (cr ?? item)?.title ?? null, state: (cr ?? item)?.state ?? null, url: (cr ?? item)?.url ?? null,
    participants, language, decisions,
    comments: comments.length, openReviewThreads: reviews.filter((t) => !t.resolved).length,
    last: human.slice(-3).map((c) => ({ author: c.author, at: c.at, language: detectLanguage(c.body), excerpt: c.body.split('\n').find((l) => l.trim())?.slice(0, 160) ?? '' })),
  }
}

/** @mentions only for real people: a handle not among the participants loses its @ (and goes in backticks). */
export function realMentions(text, people) {
  const known = new Set(people.map((p) => p.toLowerCase()))
  return String(text).replace(/(^|[^\w.`/@-])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))(?![\w@.-]*\.\w)/g, (m, pre, login) => (known.has(login.toLowerCase()) ? m : `${pre}\`${login}\``))
}

/**
 * A reply ready to post in answer to a comment: in the comment's language (ro made ASCII), mentioning only real
 * people. `problems` says why it should not be posted as written (the reply is in another language).
 */
export function prepareReply(body, { to, people = [], fallback = 'en' } = {}) {
  const lang = detectLanguage(to?.body) ?? fallback
  let text = realMentions(body, people)
  if (lang === 'ro') text = toAscii(text)
  const own = detectLanguage(text)
  const problems = own && own !== lang ? [`the comment is in ${lang} but the reply is in ${own}: answer in ${lang}${lang === 'ro' ? ' (ASCII, no diacritics)' : ''}`] : []
  return { lang, body: text, problems }
}

/** The journal section that quotes the decisions verbatim, with who made them, when and where. */
export function decisionsSection(threads, { lang = 'en' } = {}) {
  const items = threads.flatMap((t) => t.decisions.map((d) => ({ ...d, number: t.number })))
  if (!items.length) return ''
  const heading = lang === 'ro' ? '## Decizii din discutie' : '## Decisions from the conversation'
  const quote = (d) => `${d.text.split('\n').map((l) => `> ${l}`).join('\n')}\n\n-- ${d.author ? `@${d.author}` : 'unknown'}${d.at ? `, ${String(d.at).slice(0, 10)}` : ''}, #${d.number}${d.url ? ` (${d.url})` : ''}`
  return `${heading}\n\n${items.map(quote).join('\n\n')}\n`
}
