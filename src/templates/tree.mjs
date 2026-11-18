// Renders a folder of templates for one project: picks the language variant of each file from the area it declares,
// renders it with the project's context and returns the files in a stable order. Nothing is written here.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { render, formatFor, TemplateError } from './engine.mjs'
import { AREAS, LANGUAGES, languageFor, labelSet } from '../i18n/i18n.mjs'
import { slotsFor } from '../registry/slots.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'

const VARIANT = new RegExp(`^(.*)\\.(${LANGUAGES.join('|')})(\\.[^./]+)$`)
const AREA_DECL = /^\{\{!\s*area:\s*([\w-]+)\s*\}\}/

/**
 * The values templates can use: the merged configuration, `pack.<id>` flags, `lang.<area>` and `labels`
 * (core label names in the `labels` language, addressed as labels.type.bug or labels.needs-decision) and `vocab`
 * (the platform's words: vocab.changeRequest, vocab.crRef, …).
 * @param {object} config merged configuration (src/config)
 */
/**
 * How generated CI jobs run (#95): the image (ci.image, else the given default), runner tags as a YAML flow list
 * (GitLab tags, GitHub runs-on labels) and the agent-os command, pinned and from the internal registry when set.
 */
export function runnerContext(config) {
  const tags = config.ci?.tags ?? []
  const flow = tags.length ? `[${tags.map((t) => JSON.stringify(t)).join(', ')}]` : ''
  const registry = config.npmRegistry ? ` --registry ${config.npmRegistry}` : ''
  return {
    image: config.ci?.image ?? null,
    gitlabImage: config.ci?.image ?? 'node:22',
    tags: flow,
    runsOn: flow || 'ubuntu-latest',
    npmRegistry: config.npmRegistry ?? null,
    npx: `npx -y${registry} @cosmin-sisman/agent-os${config.version ? `@${config.version}` : ''}`,
  }
}

export function buildContext(config) {
  const labels = {}
  for (const l of labelSet(config)) {
    const [group, name] = l.id.includes(':') ? l.id.split(':') : [null, l.id]
    if (group) (labels[group] ??= {})[name] = l.name
    else labels[name] = l.name
  }
  return {
    ...config,
    pack: Object.fromEntries((config.packs ?? []).map((p) => [p, true])),
    lang: Object.fromEntries(AREAS.map((a) => [a.id, languageFor(config, a.id)])),
    slots: slotsFor(config),
    labels,
    vocab: vocabularyFor(config.platform?.type),
    // CI expressions such as ${{ secrets.GITHUB_TOKEN }} use the same braces as templates: write {{{expr.open}}} … {{{expr.close}}}.
    expr: { open: '${{', close: '}}' },
    runner: runnerContext(config),
  }
}

function walk(dir, root = dir) {
  return readdirSync(dir).sort().flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full, root) : [relative(root, full).split(sep).join('/')]
  })
}

/**
 * Renders every template under `dir`. `name.en.ext` and `name.ro.ext` are variants of `name.ext`: they declare their
 * area on the first line ({{! area: issues }}), and the variant in that area's language is rendered. Path segments
 * like __crSkill__ are replaced by the platform vocabulary, so one template can land at .claude/skills/pr or …/mr.
 * @param {string} dir
 * @param {object} config merged configuration
 * @returns {{ path: string, content: string, area: string | null, lang: string | null }[]} sorted by path
 */
export function renderTree(dir, config) {
  const context = buildContext(config)
  const groups = new Map()
  for (const file of walk(dir)) {
    const m = file.match(VARIANT)
    const out = m ? `${m[1]}${m[3]}` : file
    const g = groups.get(out) ?? { out, variants: {}, plain: null }
    if (m) g.variants[m[2]] = file
    else g.plain = file
    groups.set(out, g)
  }
  const results = []
  const outPath = (path, file) => path.replace(/__(\w+)__/g, (_, name) => {
    if (typeof context.vocab[name] !== 'string') throw new TemplateError(`unknown path placeholder __${name}__ (use a vocab key)`, { file, line: 1, col: 1 })
    return context.vocab[name]
  })
  for (const g of [...groups.values()].sort((a, b) => a.out.localeCompare(b.out))) {
    const variants = Object.entries(g.variants)
    if (g.plain && variants.length) throw new TemplateError(`${g.out} has both a plain file and language variants; keep one kind`, { file: g.plain, line: 1, col: 1 })
    if (!variants.length) {
      const source = readFileSync(join(dir, g.plain), 'utf8')
      results.push({ path: outPath(g.out, g.plain), content: render(source, context, { file: g.plain, format: formatFor(g.out) }), area: source.match(AREA_DECL)?.[1] ?? null, lang: null })
      continue
    }
    const areas = new Set()
    for (const [, file] of variants) {
      const area = readFileSync(join(dir, file), 'utf8').match(AREA_DECL)?.[1]
      if (!area) throw new TemplateError('language variants must declare their area on the first line: {{! area: <area> }}', { file, line: 1, col: 1 })
      if (!AREAS.some((a) => a.id === area)) throw new TemplateError(`unknown area "${area}"`, { file, line: 1, col: 1 })
      areas.add(area)
    }
    if (areas.size > 1) throw new TemplateError(`variants of ${g.out} declare different areas: ${[...areas].join(', ')}`, { file: variants[0][1], line: 1, col: 1 })
    const area = [...areas][0]
    const lang = languageFor(config, area)
    const file = g.variants[lang]
    if (!file) throw new TemplateError(`${g.out} has no "${lang}" variant, which the ${area} area needs`, { file: variants[0][1], line: 1, col: 1 })
    results.push({ path: outPath(g.out, file), content: render(readFileSync(join(dir, file), 'utf8'), context, { file, format: formatFor(g.out) }), area, lang })
  }
  return results
}
