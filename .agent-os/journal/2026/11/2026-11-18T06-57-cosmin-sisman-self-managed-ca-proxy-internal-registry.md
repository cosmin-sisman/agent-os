---
type: note
refs: ["#95"]
areas: [platform]
author: cosmin-sisman
---

# Self-managed: CA, proxy, internal registry, runner images, version gates

Self-managed networks are handled without touching the machine. The CA bundle, the proxy (a personal setting) and the internal npm registry reach gh, glab, git and npx through agent-os's own process environment; the laptop's existing variables win, and only names are logged. Credentials in a proxy or registry URL are refused, with the value not shown. Generated CI jobs take `ci.image`, `ci.tags` and the registry, so an air-gapped runner works from the internal image. Hooks use a vendored tarball locally. Capabilities with a minimum version (CI components, OIDC tokens) are on only when the probe finds that version; unknown counts as too old. `/upstream` is off by default when platform.host is set. A test keeps the package free of its own network calls.
