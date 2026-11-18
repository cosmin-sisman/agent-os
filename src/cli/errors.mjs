// Exit codes and the error type every command throws, so failures look the same in text and JSON output.

/** Stable exit codes: scripts and CI depend on them. */
export const EXIT = Object.freeze({ OK: 0, CHECK_FAILED: 1, CANNOT_RUN: 2 })

/** An expected failure with an exit code and an optional hint telling the user what to do next. */
export class CliError extends Error {
  /**
   * @param {string} message what went wrong, in one sentence
   * @param {{ code?: number, hint?: string }} [options]
   */
  constructor(message, { code = EXIT.CANNOT_RUN, hint } = {}) {
    super(message)
    this.name = 'CliError'
    this.code = code
    this.hint = hint
  }
}
