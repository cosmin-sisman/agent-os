// Test helper: writes small .xlsx files (and hostile zips) in memory, so tests never need a binary fixture.
// zip(entries) builds a zip from { name, data, method?, declaredSize? }; xlsx(sheets) builds a workbook whose cells
// are shared strings, inline strings, numbers and formulas with a cached value.
import { deflateRawSync } from 'node:zlib'

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

export function zip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? '')
    const method = e.method ?? 8
    const body = method === 8 ? deflateRawSync(raw) : raw
    const name = Buffer.from(e.name)
    const size = e.declaredSize ?? raw.length
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc32(raw), 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(size, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42)
    locals.push(local, name, body)
    centrals.push(central, name)
    offset += local.length + name.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const col = (i) => { let s = ''; for (let n = i + 1; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }

/** sheets: [{ name, rows: (string | number | { f, v })[][] }]. Even-indexed strings are shared, odd ones inline. */
export function xlsx(sheets) {
  const shared = []
  const sheetXml = sheets.map((s) => `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = `${col(ci)}${ri + 1}`
    if (v === '' || v === null || v === undefined) return ''
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`
    if (typeof v === 'object') return `<c r="${ref}" t="str"><f>${esc(v.f)}</f><v>${esc(v.v)}</v></c>`
    if ((ri + ci) % 2 === 0) { shared.push(v); return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>` }
    return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`
  }).join('')}</row>`).join('')}</sheetData></worksheet>`)
  return zip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'xl/workbook.xml', data: `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>` },
    { name: 'xl/sharedStrings.xml', data: `<sst>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>` },
    ...sheetXml.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: x })),
  ])
}
