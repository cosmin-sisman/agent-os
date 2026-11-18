---
type: decision
refs: ["#49", "#48", "#51"]
areas: [init]
author: cosmin-sisman
---

# Init: chat first, profile confirmed, plan shown, platform only on request

The full `agent-os init`.

Decisions:
- The order follows design §11: personal chat language first, then the detected profile to confirm, then the platform, team languages, branches, and solo or team. Every question has a flag, so `--yes` with flags never prompts. That is the issue's scenario.
- The plan is shown before anything is written: configuration, .gitignore, each managed file (installed, or kept with a `.rej` when it exists and differs), and the platform steps. A dry run stops there.
- The platform is changed only with `--setup`. Init writes the repository files, while the platform setup changes settings other people rely on.
- `AGENTS.md` and `CLAUDE.md` get managed blocks (CLAUDE.md imports AGENTS.md), and the team's text around them stays byte for byte. The blocks are part of the install plan, so `update` keeps them current.
- Init suggests gate suites from package.json scripts and starts 14 days of adoption mode. Doctor runs right after, and a fresh init has 0 FAIL (the acceptance criterion).
- On this repository only a dry run, posted on #49. It shows profile `active`, the files to install, the three existing GitHub templates that would be kept with a `.rej`, and the same platform plan as #11. Nothing was written; adopting agent-os here is the owner's decision.
