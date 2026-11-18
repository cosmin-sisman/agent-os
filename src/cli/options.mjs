// The flags every command accepts. Commands add their own options in their module.

/** @type {Record<string, import('node:util').ParseArgsOptionDescriptor & { description: string }>} */
export const GLOBAL_OPTIONS = {
  json: { type: 'boolean', description: 'Print one JSON object on stdout instead of text' },
  'dry-run': { type: 'boolean', description: 'Show what would change without changing anything' },
  cwd: { type: 'string', description: 'Run as if started in this directory' },
  verbose: { type: 'boolean', description: 'Print diagnostic detail on stderr' },
  help: { type: 'boolean', short: 'h', description: 'Show help' },
  version: { type: 'boolean', short: 'v', description: 'Print the version' },
}

export const ISSUES_URL = 'https://github.com/cosmin-sisman/agent-os/issues'
