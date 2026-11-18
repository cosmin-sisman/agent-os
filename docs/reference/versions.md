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
