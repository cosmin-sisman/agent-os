// The configuration schema: one definition that drives validation, defaults and the published JSON Schemas.
// Keys marked `personal` live only in .agent-os/local.json; every other key lives only in agent-os.json.

const LANG = ['en', 'ro']

const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const oneOf = (values, description, extra = {}) => ({ type: 'string', enum: values, description, ...extra })
const bool = (description, extra = {}) => ({ type: 'boolean', description, ...extra })
const int = (description, extra = {}) => ({ type: 'integer', description, ...extra })
const list = (items, description, extra = {}) => ({ type: 'array', items, description, ...extra })
const obj = (properties, description, extra = {}) => ({ type: 'object', properties, description, ...extra })
const map = (values, description, extra = {}) => ({ type: 'object', additionalProperties: values, description, ...extra })
const lang = (description) => oneOf(LANG, `${description} (en, or ro written without diacritics)`, { default: 'en' })

/** The whole configuration, team and personal keys together. */
export const SCHEMA = obj({
  $schema: str('Path or URL of the JSON Schema, for editors'),
  version: str('The exact agent-os version this project is pinned to', { pattern: '^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$' }),
  profile: oneOf(['greenfield', 'spec-first', 'active', 'maintenance'], 'Where the project is in its life', { default: 'active' }),
  platform: obj({
    type: oneOf(['github', 'gitlab'], 'The code platform', { default: 'github' }),
    host: str('Base URL for GitHub Enterprise Server or GitLab self-managed; omit for github.com and gitlab.com', { pattern: '^https?://' }),
    project: str('owner/name (GitHub) or group/subgroup/name (GitLab)', { pattern: '^[^/\\s]+(/[^/\\s]+)+$' }),
    caFile: str('Private CA bundle for a self-managed host, relative to the repository'),
    board: obj({
      owner: str('The user or organization that owns the board'),
      number: int('The board (GitHub Project) number', { minimum: 1 }),
    }, 'The planning board (GitHub Projects v2) issues are placed on, when there is one'),
  }, 'Which platform and project agent-os talks to', { default: {} }),
  branches: obj({
    integration: str('Feature PRs and MRs target this branch; it is the default branch', { default: 'development' }),
    production: str('Releases merge into this branch', { default: 'main' }),
    requiredChecks: list(str('A check name, such as ci'), 'Checks that must pass before merging into either branch', { default: [] }),
    requiredApprovals: int('Approving reviews required on pull or merge requests', { minimum: 0, maximum: 10, default: 0 }),
  }, 'Branch roles', { default: {} }),
  languages: obj({
    chat: lang('Language the agent talks to you in'),
    issues: lang('Issue titles, bodies and comments the agent starts'),
    prs: lang('Pull or merge request titles, descriptions and comments'),
    commits: lang('Commit messages'),
    branches: lang('Branch slugs'),
    labels: lang('Label names and descriptions'),
    milestones: lang('Milestone titles and descriptions'),
    releases: lang('Release notes'),
    codeComments: lang('Comments written in code'),
    docs: lang('Human documentation in docs/'),
    journal: lang('Journal entries and decision records'),
  }, 'Language per area', { default: {} }),
  packs: list(str('A pack id'), 'Optional packs installed in this project', { default: [] }),
  slots: map({ type: ['string', 'null'], description: 'The skill bound to this slot, or null for none' }, 'Capability slots and the skills bound to them', { default: {} }),
  gate: map(str('The command that runs this suite'), 'Test and check suites by name', { default: {} }),
  requires: obj({
    mcp: list(obj({
      name: str('Server name as registered in Claude Code'),
      scope: oneOf(['project', 'user'], 'Where the server is configured'),
      transport: oneOf(['stdio', 'http', 'sse'], 'How the server is reached'),
      url: str('http/sse: the server URL, used in the fix command', { pattern: '^https?://' }),
      command: str('stdio: the command that starts the server, used in the fix command'),
      optional: bool('A missing optional server is a warning, not a failure', { default: false }),
      why: str('What needs it'),
    }, 'One MCP server', { required: ['name', 'scope'] }), 'MCP servers the project needs', { default: [] }),
    cli: map(str('A semver range, or * for any version'), 'Command-line tools and their versions', { default: {} }),
    platformScopes: list(str('A token scope'), 'Token scopes the platform CLI needs', { default: [] }),
    env: list(str('An environment variable name', { pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }), 'Variables that must be set (values are never read)', { default: [] }),
    plugins: list(str('A Claude Code plugin'), 'Plugins the project expects', { default: [] }),
  }, 'What a working setup needs, checked by agent-os env', { default: {} }),
  upstream: obj({
    enabled: bool('Allow /upstream to file issues on the public agent-os repository', { default: true }),
  }, 'Feedback to the agent-os project', { default: {} }),
  compliance: obj({
    euOnly: bool('Flag providers without confirmed EU regions', { default: false }),
  }, 'Compliance constraints', { default: {} }),
  contextBudgets: map(str('A size such as 8KB', { pattern: '^\\d+(\\.\\d+)?\\s?(B|KB|MB)$' }), 'Size budgets per file or glob', { default: {} }),
  legacy: list(str('A legacy feature id'), 'Legacy features this project keeps enabled', { default: [] }),
  guards: obj({
    rules: list(obj({
      id: str('A short name, shown when the rule refuses something'),
      type: oneOf(['forbid-flags', 'forbid-pattern', 'require-env', 'min-free-memory'], 'What the rule checks'),
      pattern: str('A regular expression matched against each shell command (after splitting on && || ; |)'),
      flags: list(str('A flag such as --no-verify'), 'forbid-flags: flags refused after a matching command', { default: [] }),
      env: str('require-env: the variable that must be set, e.g. DB_RESET_OK=1 in the command or the environment', { pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }),
      message: str('What to tell the agent when the rule refuses'),
    }, 'One guard rule', { required: ['id', 'type', 'pattern'] }), 'Project guard rules, added to the built-in ones', { default: [] }),
    disable: list(str('The id of a built-in guard'), 'Built-in guards turned off for this project', { default: [] }),
  }, 'Guards that refuse risky shell commands before they run (PreToolUse)', { default: {} }),
  adoption: obj({
    warnOnlyUntil: str('Until this date (YYYY-MM-DD) guards only warn instead of refusing', { pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  }, 'Adoption mode for projects new to agent-os', { default: {} }),
  machine: obj({
    maxWorkers: int('Most agent sessions to run in parallel on this laptop', { minimum: 1, default: 3 }),
    minFreeMb: int('Refuse heavy commands below this much free memory', { minimum: 0, default: 1500 }),
    devPortStart: int('First port for dev servers in worktrees', { minimum: 1024, maximum: 65535, default: 5174 }),
  }, "This laptop's limits", { personal: true, default: {} }),
  orchestrator: bool('Run the optional orchestrator role in this laptop\'s sessions', { personal: true, default: false }),
}, 'agent-os configuration')

// chat is the one personal key inside an otherwise team object.
SCHEMA.properties.languages.properties.chat.personal = true

/**
 * Returns the part of the schema that belongs in one file: `personal: true` keeps only personal keys,
 * `false` keeps only team keys. Objects without a flag of their own are kept when any child is kept.
 */
export function pick(node, personal) {
  if (node.personal !== undefined) return node.personal === personal ? node : null
  if (node.type !== 'object' || !node.properties) return personal ? null : node
  const properties = {}
  for (const [key, child] of Object.entries(node.properties)) {
    const kept = pick(child, personal)
    if (kept) properties[key] = kept
  }
  return Object.keys(properties).length ? { ...node, properties } : null
}

/** Converts the internal schema to a JSON Schema (draft 2020-12) document for editors and other tools. */
export function toJsonSchema(personal) {
  const strip = (node) => {
    const { personal: _p, properties, items, additionalProperties, ...rest } = node
    const out = { ...rest }
    if (properties) {
      out.properties = Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, strip(v)]))
      out.additionalProperties = false
    }
    if (items) out.items = strip(items)
    if (additionalProperties) out.additionalProperties = strip(additionalProperties)
    return out
  }
  const root = strip(pick(SCHEMA, personal))
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://github.com/cosmin-sisman/agent-os/schema/${personal ? 'local' : 'agent-os'}.schema.json`,
    title: personal ? 'agent-os personal settings (.agent-os/local.json)' : 'agent-os team configuration (agent-os.json)',
    ...root,
  }
}
