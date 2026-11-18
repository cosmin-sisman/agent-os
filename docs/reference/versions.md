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

Upgrading the pin is a team decision made in a pull or merge request (`agent-os update`, #68).

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
- The full `agent-os update` (#68) runs migrations as one of its steps, on its own branch.

How to write one: [migrations/README.md](../../migrations/README.md).
