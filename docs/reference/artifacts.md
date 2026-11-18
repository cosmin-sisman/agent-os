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

## Build and verify

```sh
agent-os artifact build <id> [--dry-run]   # a page made from template.html and its sources
agent-os artifact build --living           # every living artifact that has a template (what CI rebuilds)
agent-os artifact verify [<id>] [--strict] # stale when a source changed; --strict exits 1 then
```

- **build** takes `template.html` from the artifact's folder and replaces its `__DATA__` placeholder with every YAML or JSON source, parsed and keyed by file name (`catalog/layers.yaml` → `layers`). The data is embedded as ASCII JSON that cannot close its `<script>`. A template that is a fragment gets the document skeleton. Then build records a sha256 for every source, the template included, in `artifact.yaml`; the rest of the file is kept. An artifact with no template is written by hand, and build refuses it.
- **verify** compares each source with its recorded hash. A changed or missing source makes the artifact stale. A living one is rebuilt with `build`; a snapshot stays as it was, since a new date makes a new artifact. Without `--strict` stale artifacts are reported and the command exits 0; with `--strict` it exits 1. `list` and the Pages index show the same staleness.

`link` and `publish` come with later issues. Rebuilding living artifacts in a project's CI comes with the installable Pages workflow (#84).
