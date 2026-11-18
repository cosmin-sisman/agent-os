#!/usr/bin/env node
// The agent-os executable: hands the arguments to the CLI runner and sets the exit code it returns.
import { createInterface } from 'node:readline/promises'
import { run } from '../src/cli/main.mjs'

// Questions are asked only on an interactive terminal; elsewhere commands use flags and defaults.
let rl
const ask = process.stdin.isTTY
  ? async (text) => { rl ??= createInterface({ input: process.stdin, output: process.stderr }); return rl.question(text) }
  : undefined

process.exitCode = await run(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: process.cwd(),
  env: process.env,
  ask,
  readStdin: async () => {
    if (process.stdin.isTTY) return ''
    let data = ''
    for await (const chunk of process.stdin) data += chunk
    return data
  },
})
rl?.close()
