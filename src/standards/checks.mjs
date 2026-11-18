// The mechanical parts of the standards, shared by the on-edit reminder (PostToolUse) and doctor: a header in every
// code file, TODO only with an issue reference, comments in English (unless the team allows ro), and a file size
// limit. They remind; they never block. Design §22.

import { headerOf } from '../map/map.mjs'

export const CODE_FILE = /\.(m?[jt]sx?|cjs|py|rb|go|rs|java|kt|cs|php|swift|ex|exs|vue|svelte|sql|sh|lua|c|cc|cpp|h|hpp|scala)$/i
const COMMENT = /(?:^|\s)(?:\/\/|#(?!!)|--|\*)\s?(.*)$/

/** TODO, FIXME and XXX lines without an issue reference (#N or !N), with their 1-based line numbers. */
export function todosWithoutIssue(text) {
  return String(text).split(/\r?\n/).map((l, i) => ({ line: i + 1, text: l.trim() })).filter((l) => /\b(TODO|FIXME|XXX)\b/.test(l.text) && !/\b(TODO|FIXME|XXX)\s*\(?\s*[#!]\d+/.test(l.text) && !/[#!]\d+/.test(l.text))
}

/** Comment lines that are not plain English text (letters outside ASCII), when the team writes comments in English. */
export function nonEnglishComments(text) {
  return String(text).split(/\r?\n/).map((l, i) => ({ line: i + 1, comment: l.match(COMMENT)?.[1] ?? '' })).filter((c) => /[\p{L}&&[^\x00-\x7F]]/v.test(c.comment)).map((c) => ({ line: c.line, text: c.comment.trim() }))
}

/**
 * Every reminder for one file.
 * @param {string} file the path, relative
 * @param {string} text its content
 * @param {{ commentsLang?: string, maxLines?: number, onlyLines?: Set<number> }} options onlyLines: check TODOs only there (the edited part)
 */
export function standardsFindings(file, text, { commentsLang = 'en', maxLines = 500, onlyLines } = {}) {
  if (!CODE_FILE.test(file)) return []
  const out = []
  if (!headerOf(text)) out.push({ kind: 'header', message: `${file} has no header: open it with a 1–3 line comment saying what it is and where it fits` })
  for (const t of todosWithoutIssue(text).filter((x) => !onlyLines || onlyLines.has(x.line))) out.push({ kind: 'todo', line: t.line, message: `${file}:${t.line}: a TODO without an issue reference; write TODO(#N), or open the issue with /ticket` })
  if (commentsLang !== 'ro') for (const c of nonEnglishComments(text).slice(0, 3)) out.push({ kind: 'language', line: c.line, message: `${file}:${c.line}: this comment is not in English ("${c.text.slice(0, 40)}"); code comments are in English here` })
  const lines = String(text).split('\n').length
  if (lines > maxLines) out.push({ kind: 'size', message: `${file} is ${lines} lines, over the ${maxLines}-line limit: split it by responsibility` })
  return out
}

/** The 1-based lines of `text` that contain any line of `inserted` (for reminding only about what an edit added). */
export function linesOf(text, inserted) {
  const wanted = new Set(String(inserted ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
  return new Set(String(text).split(/\r?\n/).map((l, i) => (wanted.has(l.trim()) ? i + 1 : 0)).filter(Boolean))
}
