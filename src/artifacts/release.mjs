// The data of a release report, from the journal: what shipped (notes and releases), fixes (incidents), decisions
// and lessons between two dates, each with its references, for the release-report template (#86).

import { filterEntries, readJournal } from '../journal/journal.mjs'

const HEAD = {
  en: ['What shipped', 'Fixes', 'Decisions', 'Lessons'],
  ro: ['Ce s-a livrat', 'Reparatii', 'Decizii', 'Lectii'],
}

/** release-report data for entries between `since` and `until` (inclusive dates). */
export function releaseData(cwd, { since, until, lang = 'en', title, now = new Date() }) {
  const entries = filterEntries(readJournal(cwd), { since, until })
  const item = (e) => `${e.title ?? e.id}${(e.meta.refs ?? []).length ? ` (${e.meta.refs.join(', ')})` : ''}${e.meta.author ? `, ${e.meta.author}` : ''}`
  const of = (types) => entries.filter((e) => types.includes(e.meta.type)).map(item)
  const h = HEAD[lang] ?? HEAD.en
  const range = [since, until].filter(Boolean).join(lang === 'ro' ? ' - ' : ' to ') || (lang === 'ro' ? 'tot jurnalul' : 'the whole journal')
  return {
    kind: 'release-report',
    lang,
    title,
    subtitle: lang === 'ro' ? `Din jurnal: ${entries.length} intrari, ${range}.` : `From the journal: ${entries.length} entries, ${range}.`,
    updated: now.toISOString().slice(0, 10),
    sections: [
      { heading: h[0], items: of(['note', 'release']) },
      { heading: h[1], items: of(['incident']) },
      { heading: h[2], items: of(['decision']) },
      { heading: h[3], items: of(['lesson']) },
    ],
  }
}
