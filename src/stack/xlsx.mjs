// A bounded reader for .xlsx spreadsheets (a zip of XML parts), with node:zlib only. The file comes from outside,
// so it is read defensively: limits on the number of entries, on each entry's and the total uncompressed size and on
// the compression ratio (zip bombs), entry names with ".." or absolute paths are refused, and only cell values are
// read: formulas are never evaluated (a cell's cached value is used), and macros or external links are ignored.

import { inflateRawSync } from 'node:zlib'
import { CliError } from '../cli/errors.mjs'

export const LIMITS = { maxEntries: 500, maxEntryBytes: 32 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024, maxRatio: 200, maxFileBytes: 32 * 1024 * 1024 }

/** The entries of a zip file: { name, method, compressed, size, offset }, from its central directory. */
export function zipEntries(buf, limits = LIMITS) {
  if (buf.length > limits.maxFileBytes) throw new CliError(`the file is larger than ${limits.maxFileBytes} bytes`)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new CliError('not a zip file (no end of central directory): is it really .xlsx?')
  const count = buf.readUInt16LE(eocd + 10)
  if (count > limits.maxEntries) throw new CliError(`the file has ${count} entries, more than ${limits.maxEntries}`)
  let p = buf.readUInt32LE(eocd + 16)
  const out = []
  let total = 0
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new CliError('the zip central directory is damaged')
    const method = buf.readUInt16LE(p + 10)
    const compressed = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const offset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    if (name.split(/[\\/]/).includes('..') || /^([\\/]|[A-Za-z]:)/.test(name)) throw new CliError(`the file holds an entry with an unsafe path: ${name}`)
    if (size > limits.maxEntryBytes) throw new CliError(`${name} would unpack to ${size} bytes, more than ${limits.maxEntryBytes}`)
    if (compressed > 0 && size / compressed > limits.maxRatio) throw new CliError(`${name} is compressed ${Math.round(size / compressed)}:1, which looks like a zip bomb`)
    total += size
    if (total > limits.maxTotalBytes) throw new CliError(`the file would unpack to more than ${limits.maxTotalBytes} bytes`)
    out.push({ name, method, compressed, size, offset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** One entry's bytes; the declared size is enforced while inflating, so a lying header cannot unpack more. */
export function readEntry(buf, entry, limits = LIMITS) {
  const p = entry.offset
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new CliError(`the zip entry ${entry.name} is damaged`)
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28)
  const data = buf.subarray(start, start + entry.compressed)
  if (entry.method === 0) return data
  if (entry.method !== 8) throw new CliError(`${entry.name} uses an unsupported compression method (${entry.method})`)
  try { return inflateRawSync(data, { maxOutputLength: Math.min(entry.size, limits.maxEntryBytes) || 1 }) } catch { throw new CliError(`${entry.name} could not be unpacked within its declared size`) }
}

const unescapeXml = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e.toLowerCase()] ?? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)))
const textOf = (xml) => unescapeXml([...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => m[1]).join(''))
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null
const colIndex = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1

/** Every sheet of an .xlsx as { name, rows: string[][] }, values only (shared strings, inline strings, cached values). */
export function readXlsx(buf, limits = LIMITS) {
  const entries = zipEntries(buf, limits)
  const get = (name) => { const e = entries.find((x) => x.name === name); return e ? readEntry(buf, e, limits).toString('utf8') : null }
  const shared = [...(get('xl/sharedStrings.xml') ?? '').matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => textOf(m[1]))
  const workbook = get('xl/workbook.xml')
  if (!workbook) throw new CliError('not a spreadsheet: xl/workbook.xml is missing')
  const rels = Object.fromEntries([...(get('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]))
  return [...workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)].map((m) => {
    const target = rels[attr(m[0], 'r:id')] ?? ''
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    const xml = get(path) ?? ''
    const rows = [...xml.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)].map((r) => {
      const row = []
      for (const c of r[1].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const head = `<c${c[1]}>`
        const ref = attr(head, 'r')
        const type = attr(head, 't')
        const body = c[2] ?? ''
        const v = body.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1]
        const value = type === 's' ? shared[Number(v)] ?? '' : type === 'inlineStr' ? textOf(body) : v !== undefined ? unescapeXml(v) : ''
        row[ref ? colIndex(ref) : row.length] = value
      }
      return Array.from(row, (x) => x ?? '')
    })
    return { name: unescapeXml(attr(m[0], 'name') ?? ''), rows }
  })
}
