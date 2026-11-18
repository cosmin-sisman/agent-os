# Configuration reference

agent-os reads two files at the root of a repository:

| File | Holds | In git |
|---|---|---|
| `agent-os.json` | the team's agreement: platform, branches, shared languages, packs, slots, gate, requirements | committed |
| `.agent-os/local.json` | one person's settings: chat language, machine limits, orchestrator | gitignored |

Every key belongs to exactly one file. A personal key in `agent-os.json`, or a team key in `.agent-os/local.json`, is an error that names the right file. Missing keys take their defaults, and the personal file overrides only its own keys.

```bash
agent-os config                          # the merged configuration, with defaults
agent-os config get languages.issues     # one value
agent-os config set languages.issues ro  # team key → agent-os.json
agent-os config set languages.chat en    # personal key → .agent-os/local.json (and .gitignore entries)
agent-os config unset gate.unit
agent-os config validate                 # exit 0 valid, 1 problems, 2 could not read
agent-os config path
```

Values are read as JSON when they parse (`true`, `3`, `["a","b"]`, `{"x":1}`), and as plain strings otherwise. `--dry-run` shows what would change.

Editors validate both files with the published schemas: [`schema/agent-os.schema.json`](../../schema/agent-os.schema.json) and [`schema/local.schema.json`](../../schema/local.schema.json). New `agent-os.json` files reference the first through `$schema`.

The `ro` language means Romanian **without diacritics** (ASCII only), so it reads the same in every terminal, branch name and search box.

## Keys

The table below is generated from `src/config/schema.mjs` by `npm run schema`; don't edit it by hand.

<!-- generated:config-keys:start -->
| Key | File | Type | Default | Description |
|---|---|---|---|---|
| `$schema` | team | string |  | Path or URL of the JSON Schema, for editors |
| `version` | team | string |  | The exact agent-os version this project is pinned to |
| `profile` | team | string: `greenfield`, `spec-first`, `active`, `maintenance` | `"active"` | Where the project is in its life |
| `platform` | team | object | `{}` | Which platform and project agent-os talks to |
| `platform.type` | team | string: `github`, `gitlab` | `"github"` | The code platform |
| `platform.host` | team | string |  | Base URL for GitHub Enterprise Server or GitLab self-managed; omit for github.com and gitlab.com |
| `platform.project` | team | string |  | owner/name (GitHub) or group/subgroup/name (GitLab) |
| `platform.caFile` | team | string |  | Private CA bundle for a self-managed host, relative to the repository |
| `branches` | team | object | `{}` | Branch roles |
| `branches.integration` | team | string | `"development"` | Feature PRs and MRs target this branch; it is the default branch |
| `branches.production` | team | string | `"main"` | Releases merge into this branch |
| `languages` | team | object | `{}` | Language per area |
| `languages.chat` | personal | string: `en`, `ro` | `"en"` | Language the agent talks to you in (en, or ro written without diacritics) |
| `languages.issues` | team | string: `en`, `ro` | `"en"` | Issue titles, bodies and comments the agent starts (en, or ro written without diacritics) |
| `languages.prs` | team | string: `en`, `ro` | `"en"` | Pull or merge request titles, descriptions and comments (en, or ro written without diacritics) |
| `languages.commits` | team | string: `en`, `ro` | `"en"` | Commit messages (en, or ro written without diacritics) |
| `languages.branches` | team | string: `en`, `ro` | `"en"` | Branch slugs (en, or ro written without diacritics) |
| `languages.labels` | team | string: `en`, `ro` | `"en"` | Label names and descriptions (en, or ro written without diacritics) |
| `languages.milestones` | team | string: `en`, `ro` | `"en"` | Milestone titles and descriptions (en, or ro written without diacritics) |
| `languages.releases` | team | string: `en`, `ro` | `"en"` | Release notes (en, or ro written without diacritics) |
| `languages.codeComments` | team | string: `en`, `ro` | `"en"` | Comments written in code (en, or ro written without diacritics) |
| `languages.docs` | team | string: `en`, `ro` | `"en"` | Human documentation in docs/ (en, or ro written without diacritics) |
| `languages.journal` | team | string: `en`, `ro` | `"en"` | Journal entries and decision records (en, or ro written without diacritics) |
| `packs` | team | array | `[]` | Optional packs installed in this project |
| `slots` | team | object | `{}` | Capability slots and the skills bound to them |
| `slots.<name>` | team | string or null |  | The skill bound to this slot, or null for none |
| `gate` | team | object | `{}` | Test and check suites by name |
| `gate.<name>` | team | string |  | The command that runs this suite |
| `requires` | team | object | `{}` | What a working setup needs, checked by agent-os env |
| `requires.mcp` | team | array | `[]` | MCP servers the project needs |
| `requires.mcp[].name` | team | string |  | Server name as registered in Claude Code |
| `requires.mcp[].scope` | team | string: `project`, `user` |  | Where the server is configured |
| `requires.mcp[].transport` | team | string: `stdio`, `http`, `sse` |  | How the server is reached |
| `requires.mcp[].optional` | team | boolean | `false` | A missing optional server is a warning, not a failure |
| `requires.mcp[].why` | team | string |  | What needs it |
| `requires.cli` | team | object | `{}` | Command-line tools and their versions |
| `requires.cli.<name>` | team | string |  | A semver range, or * for any version |
| `requires.platformScopes` | team | array | `[]` | Token scopes the platform CLI needs |
| `requires.env` | team | array | `[]` | Variables that must be set (values are never read) |
| `requires.plugins` | team | array | `[]` | Plugins the project expects |
| `upstream` | team | object | `{}` | Feedback to the agent-os project |
| `upstream.enabled` | team | boolean | `true` | Allow /upstream to file issues on the public agent-os repository |
| `compliance` | team | object | `{}` | Compliance constraints |
| `compliance.euOnly` | team | boolean | `false` | Flag providers without confirmed EU regions |
| `contextBudgets` | team | object | `{}` | Size budgets per file or glob |
| `contextBudgets.<name>` | team | string |  | A size such as 8KB |
| `legacy` | team | array | `[]` | Legacy features this project keeps enabled |
| `machine` | personal | object | `{}` | This laptop's limits |
| `machine.maxWorkers` | personal | integer | `3` | Most agent sessions to run in parallel on this laptop |
| `machine.minFreeMb` | personal | integer | `1500` | Refuse heavy commands below this much free memory |
| `machine.devPortStart` | personal | integer | `5174` | First port for dev servers in worktrees |
| `orchestrator` | personal | boolean | `false` | Run the optional orchestrator role in this laptop's sessions |
<!-- generated:config-keys:end -->
