// The gate: the suites a diff needs, from one definition in agent-os.json. `gate` maps suite names to commands and
// `gatePaths` maps path globs to suite names; the same selection runs on every laptop and in CI. Design §17.

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { matches } from '../util/glob.mjs'
import { testGaps } from '../testing/test.mjs'
import { areaLayers, areasFor, layersOf } from '../stack/areas.mjs'

export const RESULT_FILE = '.agent-os/cache/gate.json'

const lines = (r) => (r.status === 0 ? r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : null)

/** Files changed on this branch against the base (committed, staged, unstaged and untracked), sorted and unique. */
export function changedFiles(git, base) {
  const committed = lines(git(['diff', '--name-only', `origin/${base}...HEAD`]))
  if (committed === null) throw new CliError(`cannot diff against origin/${base}`, { hint: `git fetch origin ${base}` })
  const local = lines(git(['diff', '--name-only', 'HEAD'])) ?? []
  const untracked = lines(git(['ls-files', '--others', '--exclude-standard'])) ?? []
  return [...new Set([...committed, ...local, ...untracked])].sort()
}

/** True when the working tree has no changes (so a result applies to HEAD exactly). */
export const isClean = (git) => (lines(git(['status', '--porcelain'])) ?? ['?']).length === 0

/**
 * Which suites the files need, in the order the suites are defined.
 * @returns {{ suites: string[], reasons: Record<string, string[]>, unmatched: string[], mode: string }}
 */
export function selectSuites(config, files, { all = false, only = [] } = {}) {
  const defined = Object.keys(config.gate ?? {})
  const unknown = [...only, ...Object.values(config.gatePaths ?? {}).flat()].filter((s) => !defined.includes(s))
  if (unknown.length) throw new CliError(`unknown suite(s): ${[...new Set(unknown)].join(', ')}`, { hint: `defined in "gate": ${defined.join(', ') || 'none'}` })
  if (only.length) return { suites: defined.filter((s) => only.includes(s)), reasons: Object.fromEntries(only.map((s) => [s, ['--suite']])), unmatched: [], mode: 'only' }
  const paths = Object.entries(config.gatePaths ?? {})
  if (all || !paths.length) return { suites: defined, reasons: Object.fromEntries(defined.map((s) => [s, [all ? '--all' : 'no gatePaths: every suite runs']])), unmatched: [], mode: all ? 'all' : 'no-paths' }
  const reasons = {}
  const unmatched = []
  for (const f of files) {
    const hit = paths.filter(([glob]) => matches(f, glob))
    if (!hit.length) unmatched.push(f)
    for (const [, suites] of hit) for (const s of suites) if (!(reasons[s] ??= []).includes(f)) reasons[s].push(f)
  }
  return { suites: defined.filter((s) => reasons[s]), reasons, unmatched, mode: 'paths' }
}

/** Runs a shell command and returns its exit status, combined output and duration. */
export function systemExec(command, { cwd }) {
  const start = Date.now()
  const r = spawnSync(command, { cwd, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true })
  return { status: r.status ?? 1, output: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`, durationMs: Date.now() - start }
}

/** Runs the selected suites, all of them even after a failure, so the table is complete. */
export function runSuites(config, suites, { cwd, exec = systemExec }) {
  return suites.map((name) => {
    const command = config.gate[name]
    const r = exec(command, { cwd })
    return { name, command, passed: r.status === 0, exitCode: r.status, durationMs: r.durationMs ?? 0, tail: r.status === 0 ? '' : r.output.trimEnd().split(/\r?\n/).slice(-15).join('\n') }
  })
}

/** The results as a Markdown table for the change request body. */
export function resultsTable(result) {
  if (!result.suites.length) return '_No gate suites ran (none configured or none needed)._'
  const rows = result.suites.map((s) => `| ${s.name} | \`${s.command.replace(/\|/g, '\\|')}\` | ${s.passed ? 'passed' : `**failed** (exit ${s.exitCode})`} | ${(s.durationMs / 1000).toFixed(1)} s |`)
  return ['| Suite | Command | Result | Time |', '|---|---|---|---|', ...rows].join('\n')
}

export function saveResult(cwd, result) {
  mkdirSync(join(cwd, '.agent-os', 'cache'), { recursive: true })
  writeFileSync(join(cwd, RESULT_FILE), `${JSON.stringify(result, null, 2)}\n`)
}

export function readResult(cwd) {
  try { return JSON.parse(readFileSync(join(cwd, RESULT_FILE), 'utf8')) } catch { return null }
}

/**
 * Selects and runs the gate for the current branch.
 * @param {{ config: object, git: Function, cwd: string, exec?: Function }} deps
 * @param {{ base?: string, all?: boolean, only?: string[], dryRun?: boolean }} [options]
 */
export function runGate({ config, git, cwd, exec }, { base = config.branches.integration, all = false, only = [], dryRun = false } = {}) {
  const files = all || only.length ? [] : changedFiles(git, base)
  const sel = selectSuites(config, files, { all, only })
  // Suites attached to layers (gateLayers: { "data-layer": ["migrations"] }) run when the diff touches the layer.
  if (!all && !only.length && Object.keys(config.gateLayers ?? {}).length) {
    for (const area of areasFor(files, cwd)) {
      const layer = area.replace(/^area:/, '')
      for (const suite of (config.gateLayers[layer] ?? []).filter((x) => config.gate?.[x])) {
        if (!sel.suites.includes(suite)) sel.suites.push(suite)
        ;(sel.reasons[suite] ??= []).push(`layer ${layer}`)
      }
    }
    const layers = areaLayers(cwd)
    sel.unmatched = sel.unmatched.filter((f) => !layersOf(f, layers).some((l) => (config.gateLayers[l] ?? []).length))
  }
  const head = lines(git(['rev-parse', 'HEAD']))?.[0] ?? null
  const clean = isClean(git)
  const warnings = []
  if (!Object.keys(config.gate ?? {}).length) warnings.push('no gate suites are configured: add them under "gate" (and "gatePaths") in agent-os.json')
  if (sel.unmatched.length) warnings.push(`no suite covers ${sel.unmatched.length} changed file(s): ${sel.unmatched.slice(0, 5).join(', ')}${sel.unmatched.length > 5 ? ', …' : ''}`)
  const gaps = files.length ? testGaps(files, { exclude: config.testing?.exclude ?? [], map: config.testing?.map ?? {} }) : []
  if (gaps.length) warnings.push(`${gaps.length} changed file(s) with no changed test: ${gaps.slice(0, 5).join(', ')}${gaps.length > 5 ? ', …' : ''} (agent-os test gaps)`)
  if (dryRun) return { dryRun: true, base, head, clean, files, ...sel, gaps, warnings }
  const suites = runSuites(config, sel.suites, { cwd, exec })
  const result = { base, head, clean, at: new Date().toISOString(), files, mode: sel.mode, reasons: sel.reasons, unmatched: sel.unmatched, gaps, suites, ok: suites.every((s) => s.passed), warnings }
  saveResult(cwd, result)
  return result
}
