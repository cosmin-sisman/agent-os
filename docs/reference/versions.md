# Versions

Everyone on a project runs the same agent-os: the exact version in `agent-os.json → version`. Design: [§19](../design/overview.md).

```bash
agent-os config set version 0.4.2     # pin it (the full init does this for you)
agent-os version                      # what is running
agent-os version --check              # compare with the pin; exit 1 with the fix on a mismatch
```

## How the pin reaches every laptop

- **Hooks are always pinned.** `.claude/settings.json` is installed with `npx -y @cosmin-sisman/agent-os@<version> hook <Event>`. When the project has agent-os as an **exact** devDependency, the hooks use the project's own install (`npx --no-install agent-os`), which the lockfile pins. A bare `npx agent-os` is never written.
- **SessionStart warns once** when what runs differs from the pin, with the fix:

| Problem | Fix shown |
|---|---|
| the running version differs from the pin | `npm install -D @cosmin-sisman/agent-os@<pin>`, or run it through npx with the pin |
| `package.json` allows a range (`^0.4.0`) | `npm install -D -E @cosmin-sisman/agent-os@<pin>` |
| `package.json` pins another exact version | `npm install -D -E …@<pin>` |
| `node_modules` holds another version | `npm ci` |
| nothing is pinned | `agent-os config set version <running>` |

Upgrading the pin is a team decision made in a pull or merge request (`agent-os update`, below).

## Lifecycle: nothing disappears without warning

`manifest.json` lists every item agent-os ships, with its state. Items are commands, their flags, configuration keys, templates, catalog entries and hook handlers. It is rebuilt and committed at each release, and it is the baseline the next changes are checked against.

| State | Means |
|---|---|
| `new` | appeared recently; may still change before it becomes stable |
| `stable` | covered by the compatibility promise |
| `deprecated` | still works; has `deprecatedIn`, `removeIn` and a `replacement` |
| `legacy` | kept only for projects that opt in |
| `removed` | gone; kept in the manifest with the migration that handles it |

Allowed changes: new → stable or deprecated; stable → deprecated; deprecated → legacy, removed (or back to stable); legacy → removed. **Nothing goes from stable to removed directly.** Every pull request runs these rules against the committed manifest. An item that disappears without a lifecycle entry, a deprecation without its replacement or removal version, or a removal without its migration fails the build.

States change only in [`src/lifecycle/lifecycle.yaml`](../../src/lifecycle/lifecycle.yaml).

```bash
agent-os manifest check     # the rules, against the last released manifest
agent-os manifest build     # at release: write manifest.json
agent-os manifest usage     # deprecated items this project still uses (config keys, commands and flags in its hooks)
```

## Migrations

When a new version changes something in projects (configuration keys, registry entries, journal or lesson formats, `stack.yaml`), it ships a migration: `migrations/<version>.mjs`. The update runs the ones between the project's pinned version and the new one, in version order (0.9.0 before 0.10.0).

```bash
agent-os update --migrate --dry-run   # what would change, per migration
agent-os update --migrate             # run them
```

- Every migration is **idempotent**. A test runs each one twice against its fixture project (`migrations/__fixtures__/<version>/`), and the second run must change nothing.
- The applied versions are recorded in `.agent-os/lock.json`, so a rerun skips them.
- A failing migration stops the chain with its name. The ones before it stay applied, and a rerun continues from the failed one.
- `agent-os update` runs them as one of its steps, on its own branch.

How to write one: [migrations/README.md](../../migrations/README.md).

## Updating: `update --plan` and `update`

Run the version you want to move to; the project's pin is the starting point:

```bash
npx -y @cosmin-sisman/agent-os@0.5.0 update --plan     # read-only
npx -y @cosmin-sisman/agent-os@0.5.0 update            # branch + change request
npx -y @cosmin-sisman/agent-os@0.6.0-next.1 update --channel next   # try a pre-release; the pin is not changed
agent-os update --no-pr                                # do it on the branch, push and open it yourself
```

**The plan** groups the changes between the pinned version and the target as Breaking, New, Deprecated, Legacy, Removed, Fixes and Chore. They come from `changelog.yaml` and from the lifecycle states in `manifest.json`. It also lists the managed files that would change (replaced, merged with your local edits, or in conflict), the migrations that will run and the deprecated items this project still uses. It changes nothing.

**The update**:

1. **Preflight.** Requires a clean working tree, a target that is not older than the pin (and not a pre-release, unless `--channel next`), the target's minimum Node version, and no failure from `doctor --ci`.
2. **Branch.** It creates `chore/agent-os-<version>` from `origin/<branches.integration>`. Nothing is written to the integration or default branch.
3. **Migrate.** Runs the migrations after the pin up to the target, in order.
4. **Pin.** Sets `version` in `agent-os.json`, except with `--channel next`.
5. **Apply.** Writes the managed files through the lock rules. A local edit that conflicts leaves the local file as it is and writes `<file>.rej`, which is committed so the reviewers see it.
6. **Record.** Adds a `release` journal entry and makes one commit, `chore(agent-os): update to <version>`.
7. **Verify.** Runs the gate on that commit.
8. **Open.** Pushes the branch and opens the change request. Its body carries the plan, the migration log, the conflicts as a checklist, the gate results, and a **Before merge** item for each `.rej`. It opens as a draft when there are conflicts or the gate failed (exit 1).

Afterwards you are back on the branch you started from. **To roll back, close the change request** (or revert it after merging): the update exists only on its branch until then.

## Legacy features and deprecation notes

A **legacy** feature is an old behaviour kept for teams that still need it. It ships as `templates/legacy/<id>/` and is installed only when the project opts in:

```json
{ "legacy": ["old-flow"] }
```

- Without the opt-in, nothing from `templates/legacy/` is installed.
- With it, `agent-os update` and `setup` install the feature's files next to core. They are managed like any other file.
- `agent-os doctor` reports each enabled feature as **debt**, with its removal version and what replaces it (from `src/lifecycle/lifecycle.yaml`, id `legacy:<id>`). It fails on an id this version does not have.
- `doctor` also lists every **deprecated** item the project still uses (config keys in `agent-os.json` or `.agent-os/local.json`, commands and flags in its hooks), each with its replacement.
- When a deprecated or legacy command or flag runs, agent-os prints a note on stderr, so `--json` output stays clean: `agent-os: note: hook --print-settings is deprecated and will be removed in 0.7.0; use setup`.

## Release notes: `release notes`

```bash
agent-os release notes --from v0.1.0 --version 0.2.0               # Markdown for the release page
agent-os release notes --from v0.1.0 --version 0.2.0 --changelog   # also add the entry to changelog.yaml
agent-os release notes --from v0.1.0 --version 0.2.0 --json
```

It reads the change requests merged in `--from..--to` from the history: squash subjects that end in `(#N)` and merge commits. It groups them as Breaking, New, Deprecated, Legacy, Removed, Fixes and Chore:

1. a `changelog:*` label decides first (`changelog:breaking`, `changelog:new`, `changelog:deprecation`, `changelog:legacy`, `changelog:removed`);
2. then the type label (`type:feature` → New, `type:bug` → Fixes, docs/chore/research → Chore);
3. then the title's type (`feat` → New, `fix`/`perf` → Fixes, a `!` → Breaking).

Two lines in a change request's description feed the notes:

- `Migration: migrations/0.2.0.mjs`. Every breaking or removal item must name its migration, or `migrations/<version>.mjs` must exist. Otherwise the command lists the problem and exits 1.
- `Replacement: <what to use instead>`. Every deprecation must name its replacement.

Decision records, incidents and release entries added to the journal in the range are listed under *Decisions and incidents*. `--changelog` writes the same entry that `update --plan` reads, keeping the file's comment header. Nothing is published; the release flow is #17.
