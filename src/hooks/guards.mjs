// Guard rules for PreToolUse: refuse risky shell commands before they run. Built-in rules protect the
// workflow's safety nets (git hooks, secret scanning); projects add their own rules in agent-os.json → guards.

import { freemem } from 'node:os'
import { readFileSync } from 'node:fs'

/** Built-in rules, on unless a project lists their id in guards.disable. */
export const BUILT_IN = [
  {
    id: 'no-verify', type: 'forbid-flags', pattern: '^git\\s+(commit|merge|push|pull|rebase|am|cherry-pick|revert)\\b', flags: ['--no-verify'],
    message: 'skipping git hooks also skips the checks the team relies on (secret scan, tests); fix what the hook reports instead',
  },
  {
    id: 'commit-n', type: 'forbid-flags', pattern: '^git\\s+commit\\b', flags: ['-n'],
    message: '`git commit -n` skips the git hooks; fix what the hook reports instead',
  },
  {
    id: 'hooks-path', type: 'forbid-pattern', pattern: '^git\\s+(-c\\s+core\\.hookspath=|config\\s+(--\\S+\\s+)*core\\.hookspath\\b)',
    message: 'changing core.hooksPath turns off the project\'s git hooks',
  },
]

/** Splits a shell command line into simple commands on && || ; | and newlines, outside quotes. */
export function splitCommands(line) {
  const out = []
  let cur = ''
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      cur += c
      if (c === '\\' && quote === '"') { cur += line[++i] ?? ''; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") { quote = c; cur += c; continue }
    const two = line.slice(i, i + 2)
    if (two === '&&' || two === '||') { out.push(cur); cur = ''; i++; continue }
    if (c === ';' || c === '|' || c === '\n' || c === '&') { out.push(cur); cur = ''; continue }
    cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

/** Splits a simple command into words, removing quotes. */
export function words(command) {
  return [...command.matchAll(/"((?:\\.|[^"])*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3])
}

/** Leading VAR=value assignments and the command after them. */
function envPrefix(command) {
  const env = {}
  let rest = command
  for (;;) {
    const m = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S*)\s*/)
    if (!m) return { env, rest }
    env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    rest = rest.slice(m[0].length)
  }
}

/** Free memory in MB: MemAvailable on Linux (what can really be used), os.freemem elsewhere. */
export function freeMemoryMb() {
  try {
    const m = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)\s+kB/m)
    if (m) return Math.floor(Number(m[1]) / 1024)
  } catch {}
  return Math.floor(freemem() / 1024 / 1024)
}

/**
 * Checks a shell command line against the rules.
 * @param {string} line the command the agent wants to run
 * @param {{ rules: object[], env?: Record<string, string | undefined>, minFreeMb?: number, freeMb?: () => number }} options
 * @returns {{ id: string, message: string }[]} the rules it breaks
 */
export function checkCommand(line, { rules, env = {}, minFreeMb = 0, freeMb = freeMemoryMb }) {
  const broken = []
  for (const simple of splitCommands(line)) {
    const { env: inline, rest } = envPrefix(simple)
    for (const rule of rules) {
      const re = new RegExp(rule.pattern, 'i')
      if (!re.test(rest)) continue
      if (rule.type === 'forbid-pattern') broken.push(rule)
      else if (rule.type === 'forbid-flags') {
        const found = words(rest).filter((w) => (rule.flags ?? []).includes(w))
        if (found.length) broken.push({ ...rule, message: `${found.join(' ')}: ${rule.message ?? 'this flag is not allowed here'}` })
      } else if (rule.type === 'require-env') {
        if (!inline[rule.env] && !env[rule.env]) broken.push({ ...rule, message: rule.message ?? `set ${rule.env}=1 in front of the command once the team agreed to run it` })
      } else if (rule.type === 'min-free-memory') {
        const free = freeMb()
        if (free < minFreeMb) broken.push({ ...rule, message: `${rule.message ?? 'heavy command'}: only ${free} MB free, below the ${minFreeMb} MB floor (machine.minFreeMb); stop a dev server or another session first` })
      }
    }
  }
  const seen = new Set()
  return broken.filter((r) => !seen.has(r.id) && seen.add(r.id)).map((r) => ({ id: r.id, message: r.message }))
}

/** The rules in force for a merged configuration: built-ins minus disabled ones, plus the project's. */
export const rulesFor = (config) => [...BUILT_IN.filter((r) => !(config.guards?.disable ?? []).includes(r.id)), ...(config.guards?.rules ?? [])]
