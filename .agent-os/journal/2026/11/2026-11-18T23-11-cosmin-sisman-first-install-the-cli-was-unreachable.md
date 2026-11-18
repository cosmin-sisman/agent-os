---
type: incident
refs: ["#275"]
areas: [distribution]
author: cosmin-sisman
---

# First install: the CLI was unreachable and nothing was committed

The owner's first try of `install` 0.1.3, in a fresh private repository, stopped at the first skill. `/next` runs `agent-os next`, which was not on the PATH; the hooks work only because they call the pinned `npx -y @cosmin-sisman/agent-os@0.1.3`. The agent looked for an unscoped `agent-os` package, got npm E404, and concluded that agent-os is not published. The branch had no commit, and nothing was on the remote.

Fixes:
- The installed AGENTS.md block (en and ro) names the exact pinned npx command for when `agent-os` is not installed, and says never to use an unscoped package.
- The SessionStart context adds the same line when `agent-os` is not on the PATH. The PATH is checked for the file, nothing is run (`onPath` in src/util/which.mjs).
- install offers `npm i -g @cosmin-sisman/agent-os@<pinned>` when the command is missing. It asks first and never installs silently.
- In a repository with no commit, install offers the first commit and the push of the integration branch. The commit holds exactly the files init wrote, so personal ones stay out through .gitignore.
- Off a terminal and without `--yes`, both offers only print the commands to run.

Choice: the fallback lives in AGENTS.md and the session context, not in the 24 skills. Every agent reads AGENTS.md, and the session context reaches Claude Code at the start. Copying a line into each skill would be 24 places to keep in step.
