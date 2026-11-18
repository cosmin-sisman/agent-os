// The context handed to every command: parsed flags, the working directory, and output helpers that
// respect --json, so commands never write to stdout or stderr directly.

/**
 * @typedef {object} IO
 * @property {(s: string) => void} stdout
 * @property {(s: string) => void} stderr
 * @property {string} cwd
 * @property {Record<string, string | undefined>} env
 * @property {() => Promise<string>} [readStdin] reads all of stdin (hook payloads)
 * @property {(question: string) => Promise<string>} [ask] asks a question on a terminal; absent when nobody can answer
 */

export class Context {
  /**
   * @param {{ command: string, values: Record<string, unknown>, positionals: string[], cwd: string, io: IO }} init
   */
  constructor({ command, values, positionals, cwd, io }) {
    this.command = command
    this.values = values
    this.positionals = positionals
    this.cwd = cwd
    this.json = Boolean(values.json)
    this.dryRun = Boolean(values['dry-run'])
    this.verbose = Boolean(values.verbose)
    this.io = io
    this.result = undefined
  }

  /**
   * Reports the command's result: `text` for people, `data` for --json. Call it once per run.
   * @param {unknown} data
   * @param {string} [text] defaults to `data` when it is a string
   */
  output(data, text) {
    this.result = data
    if (!this.json) this.io.stdout(`${text ?? (typeof data === 'string' ? data : JSON.stringify(data, null, 2))}\n`)
  }

  /** Diagnostic detail, shown only with --verbose, always on stderr so it never breaks --json. */
  debug(message) {
    if (this.verbose) this.io.stderr(`agent-os: ${message}\n`)
  }
}
