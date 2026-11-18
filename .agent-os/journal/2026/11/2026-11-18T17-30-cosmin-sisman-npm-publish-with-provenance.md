---
type: decision
refs: ["#58"]
areas: [distribution]
author: cosmin-sisman
---

# npm publish from tags, with provenance, only when tag, package.json and main agree

The package is no longer private (`publishConfig`: public, provenance), and a test keeps its contents to what ships: no fixtures, tests, `.agent-os/` or docs. `release open` sets package.json and package-lock.json to the released version in the release commit, and `release plan` reports a lagging version. After tagging, it checks the tagged package.json.

`.github/workflows/publish.yml` runs on `v*` tags with `contents: read` plus `id-token: write` for provenance, and actions pinned by SHA. It publishes only when the tag equals `v<package.json version>`, the commit is on main and the tests pass. Without the owner's `NPM_TOKEN` secret it fails with a clear message.
