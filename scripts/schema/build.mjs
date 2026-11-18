// Writes the published JSON Schemas (schema/*.schema.json) and the key table in docs/reference/configuration.md,
// all from src/config/schema.mjs.
// Usage: node scripts/schema/build.mjs [--check]   (--check exits 1 when the committed files are out of date)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { toJsonSchema, SCHEMA } from '../../src/config/schema.mjs'

export const FILES = { 'schema/agent-os.schema.json': false, 'schema/local.schema.json': true }
export const render = (personal) => `${JSON.stringify(toJsonSchema(personal), null, 2)}\n`

export const DOC = 'docs/reference/configuration.md'
const START = '<!-- generated:config-keys:start -->'
const END = '<!-- generated:config-keys:end -->'

/** One table row per key: path, file, type, default, description. */
export function keyTable() {
  const rows = []
  const walk = (node, path, personal) => {
    const own = node.personal ?? personal
    if (path) {
      const type = [].concat(node.type).join(' or ') + (node.enum ? `: ${node.enum.map((v) => `\`${v}\``).join(', ')}` : '')
      const def = node.default === undefined ? '' : `\`${JSON.stringify(node.default)}\``
      rows.push(`| \`${path}\` | ${own ? 'personal' : 'team'} | ${type} | ${def} | ${node.description ?? ''} |`)
    }
    for (const [k, child] of Object.entries(node.properties ?? {})) walk(child, path ? `${path}.${k}` : k, own)
    if (node.additionalProperties) walk(node.additionalProperties, `${path}.<name>`, own)
    if (node.items?.properties) for (const [k, child] of Object.entries(node.items.properties)) walk(child, `${path}[].${k}`, own)
  }
  walk(SCHEMA, '', false)
  return ['| Key | File | Type | Default | Description |', '|---|---|---|---|---|', ...rows].join('\n')
}

export function renderDoc(text) {
  const a = text.indexOf(START)
  const b = text.indexOf(END)
  if (a < 0 || b < 0) throw new Error(`${DOC}: generated markers missing`)
  return `${text.slice(0, a + START.length)}\n${keyTable()}\n${text.slice(b)}`
}

function main() {
  const check = process.argv.includes('--check')
  let stale = 0
  mkdirSync('schema', { recursive: true })
  for (const [file, personal] of Object.entries(FILES)) {
    const text = render(personal)
    if (check) {
      if (!existsSync(file) || readFileSync(file, 'utf8') !== text) { console.error(`out of date: ${file} (run npm run schema)`); stale++ }
    } else writeFileSync(file, text)
  }
  const doc = readFileSync(DOC, 'utf8')
  const nextDoc = renderDoc(doc)
  if (check) { if (doc !== nextDoc) { console.error(`out of date: ${DOC} (run npm run schema)`); stale++ } } else writeFileSync(DOC, nextDoc)
  if (stale) process.exit(1)
  console.log(check ? 'schemas and reference are up to date' : `wrote ${[...Object.keys(FILES), DOC].join(', ')}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
