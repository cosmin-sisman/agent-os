---
type: note
refs: ["#113"]
areas: [system]
author: cosmin-sisman
---

# System map: system.yaml schema and detect from workspaces, with evidence

system.yaml now has a schema and a draft: `system detect` reads the repository's shape from pnpm, npm or yarn workspaces, Turborepo, Nx, Go workspaces, Cargo and Maven. Members become components and their dependencies on each other become edges, each citing its evidence file. Exposure is read only from platform files in the component's folder; anything else is asked, not guessed, and the question stays as a comment in the draft. A repository without workspaces gets one component for its root package, so every project has a starting point. `system check` validates the file, with the closest match for typos.
