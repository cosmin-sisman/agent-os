---
type: lesson
refs: ["#61"]
areas: [distribution]
author: cosmin-sisman
---

# Dogfood: agent-os installed on its own repository

`agent-os init --lang en --chat ro --solo` ran on this repository. It installed the rules, skills, hooks, registry, lock and the AGENTS.md and CLAUDE.md blocks. No workflows were installed: `ci.yml` already runs the loop and gate jobs, so the new `ci.loop`, `ci.gate` and `ci.retro` switches are off here. The three existing GitHub templates are ejected: ours stay, and updates leave them alone.

Doing it on a real repository found five bugs:
- init replaced an existing agent-os.json instead of completing it, and its dry run planned with a shallow merge;
- the hooks would have called an unpublished package through npx; the repository now runs its own `bin/agent-os.mjs`;
- managed hooks in that form were not recognized;
- `eject` only forgot a file, so the next update adopted it again or wrote a new .rej, and a file kept at install could not be ejected;
- PreToolUse never reached Edit and Write, which the branch reminder needs.

Each fix has a test.
