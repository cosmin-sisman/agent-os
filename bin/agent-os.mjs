#!/usr/bin/env node
// The agent-os executable: hands the arguments to the CLI runner and sets the exit code it returns.
import { run } from '../src/cli/main.mjs'

process.exitCode = await run(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: process.cwd(),
  env: process.env,
})
