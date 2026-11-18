# Artifacts: `artifacts/<date>-<slug>/` and `agent-os artifact`

An artifact is a page kept in the repository: `artifact.yaml` (metadata) plus a self-contained `index.html` that uses inline CSS and JS, embedded data, and makes no external calls. Design §17.

## `artifact.yaml`

| Key | What |
|---|---|
| `id` | `<YYYY-MM-DD>-<slug>`: equals the folder name and starts with a valid date |
| `title`, `summary` | required |
| `type` | `discovery`, `analysis`, `stack-map`, `comparison`, `decision-support`, `release-report`, `retro`, `architecture`, `dashboard` |
| `kind` | `snapshot` (frozen once merged: a new date is a new artifact) or `living` (regenerated in place) |
| `status` | `draft`, `current`, `stale`, `superseded` |
| `languages` | `[en]`, `[ro]` or both |
| `authors`, `refs` | lists of logins, and issues, PRs or decision ids |
| `build` | how the page is built |
| `sources` | `- path: … / sha256: …`: what it was built from; a hash that no longer matches makes it stale |

Unknown keys and values outside the lists are reported with the closest match.

## Commands

```sh
agent-os artifact new analysis auth-options [--title <t>] [--kind snapshot|living] [--ref '#82'] [--dry-run]
agent-os artifact list [--type <type>] [--json]
agent-os artifact check            # exit 1 when an artifact.yaml has problems
agent-os artifact log <id>         # the folder's git history
```

- **new** creates `artifacts/<today>-<slug>/` with `artifact.yaml` (status `draft`) and a page whose sections fit the type. For example, an analysis has Question, Options, Findings and Recommendation. `stack-map` and `dashboard` default to `living`, every other type to `snapshot`. The author defaults to your platform login.
- **list** shows each artifact with its type, kind and status, its stale sources and its problems, newest first.
- **log** lists commit, date, author and subject for the artifact's folder.

`build`, `verify`, `link` and `publish` come with later issues. The Pages build (`npm run site`) already indexes every artifact and marks stale ones.
