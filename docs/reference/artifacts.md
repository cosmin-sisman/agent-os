# Artifacts: `artifacts/<date>-<slug>/` and `agent-os artifact`

An artifact is a page kept in the repository: `artifact.yaml` (metadata) plus a self-contained `index.html` that uses inline CSS and JS, embedded data, and makes no external calls. Design §17.

## `artifact.yaml`

| Key | What |
|---|---|
| `id` | `<YYYY-MM-DD>-<slug>`: equals the folder name and starts with a valid date |
| `title`, `summary` | required |
| `type` | `discovery`, `analysis`, `stack-map`, `comparison`, `decision-support`, `release-report`, `retro`, `architecture`, `dashboard`, `audit` |
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

## Templates

`discovery`, `analysis`, `comparison`, `release-report`, `retro` and `audit` come with a template. `artifact new` creates three files in the artifact folder:
- `template.html`: one shared page that draws the data;
- `data.json`: the type's sections in the docs language (en or ro), with the title filled in;
- `index.html`: built at once from the other two.

You fill in `data.json` and run `agent-os artifact build <id>`. The data has a `title`, a `subtitle` and `sections`. Each section has a `heading` plus any of `text`, `items`, `table` (`columns` and `rows`, cells may carry a `tone` of good, bad, warn or muted) and `cards` (`title`, `text`, `tag`).

The page follows the light or dark theme and is self-contained, so every template passes the doctor artifact checks. **Data only ever reaches the page as text:** the renderer builds the page with `textContent`, never as HTML. The embedded JSON is ASCII with every `<` escaped, so no value can add markup, a script or a link. The other types (stack-map, architecture, dashboard, decision-support) start as a static page you write.

```sh
agent-os artifact new release-report v0-5-0 --title "Release 0.5.0" --from-journal --since 2026-11-01 --until 2026-11-18
```

`--from-journal` fills a release report from the journal entries in that range:
- notes and releases go under What shipped;
- incidents under Fixes;
- decisions under Decisions;
- lessons under Lessons.

Each entry keeps its references and author.

## Build and verify

```sh
agent-os artifact build <id> [--dry-run]   # a page made from template.html and its sources
agent-os artifact build --living           # every living artifact that has a template (what CI rebuilds)
agent-os artifact verify [<id>] [--strict] # stale when a source changed; --strict exits 1 then
```

- **build** takes `template.html` from the artifact's folder and replaces its `__DATA__` placeholder with every YAML or JSON source, parsed and keyed by file name (`catalog/layers.yaml` → `layers`). The data is embedded as ASCII JSON that cannot close its `<script>`. A template that is a fragment gets the document skeleton. Then build records a sha256 for every source, the template included, in `artifact.yaml`; the rest of the file is kept. An artifact with no template is written by hand, and build refuses it.
- **verify** compares each source with its recorded hash. A changed or missing source makes the artifact stale. A living one is rebuilt with `build`; a snapshot stays as it was, since a new date makes a new artifact. Without `--strict` stale artifacts are reported and the command exits 0; with `--strict` it exits 1. `list` and the Pages index show the same staleness.

## The site: `agent-os artifact site` and the Pages workflow

```sh
agent-os artifact site [<out>] [--strict]   # default out: .agent-os/cache/site (ignored by git)
```

It copies every valid artifact folder (without build-only files such as `template.html`) and writes an `index.html`:
- sections by type, newest first;
- each card shows the date, kind, status, `areas` (an optional list in `artifact.yaml`), linked items and the verification status (sources verified, or stale);
- an index by linked item.

Links point at the platform (`#N` → issues, `!N` → merge requests, on a self-managed host too). The index is self-contained like the artifacts. It is built in CI and never committed: the command refuses an output folder inside `artifacts/`. `--strict` exits 1 when an artifact is stale or has invalid metadata.

**The workflow.** Set `"artifacts": { "pages": true }` in `agent-os.json` and install. That adds `.github/workflows/agent-os-pages.yml` (GitHub Pages, deployed with `actions/deploy-pages`) or `.gitlab/agent-os-pages.yml` (a `pages` job; include it from `.gitlab-ci.yml`). Without the setting, no Pages workflow is installed. On a push to the integration branch that touches `artifacts/`, the job:
1. rebuilds living artifacts (`artifact build --living`);
2. builds the site;
3. publishes it.

Both pass `agent-os ci review`, and they use `ci.image`, `ci.tags` and `npmRegistry` like the other generated jobs.

**Private repositories.**
- GitHub Pages for a private repository needs a plan that supports it (Enterprise Cloud can restrict it to members).
- On GitLab, the Pages access control setting limits the site to project members. If the administrator disabled Pages, the job still keeps the site as its artifact (30 days), linked from the pipeline.

## Link: `agent-os artifact link`

```sh
agent-os artifact link 2026-11-18-queues '#42'    # an issue
agent-os artifact link 2026-11-18-queues '!7'     # a change request (the CR reference of your platform)
```

This posts one comment with the artifact's title, type, status and summary:
- **The repository copy always comes first** (`…/tree/<integration branch>/artifacts/<id>`), since it is the source of truth.
- The published site comes second, when `artifacts.siteUrl` is set.
- The comment is written in the thread's language, detected from its comments, else the issues or change requests language. Romanian is written without diacritics.
- The ref is added to the artifact's `refs`, once.

`--dry-run` shows the comment and changes nothing. The pull and merge request templates have an optional `## Artifacts` section, and the `/artifact` skill covers new, build, verify and link.

**Publishing to an external host** (such as claude.ai) is not part of agent-os yet: those links are personal, and the repository copy stays the source of truth.
