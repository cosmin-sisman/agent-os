---
type: decision
refs: ["#41", "#38", "#30"]
areas: [skills]
author: cosmin-sisman
---

# Skill index rendered from the registry, never committed

`agent-os skills` renders Core, External and Local tables from the registry and the folders, and the SessionStart line uses the same index.

Decisions:
- The index is rendered every time and never committed. That way adding a skill needs no edit to AGENTS.md, the acceptance criterion; a hand-kept index in AGENTS.md is what fell behind and conflicted before.
- An unregistered folder is listed under Local, marked unregistered, so a new local skill appears immediately (the issue's scenario). doctor still fails until it is registered (#38).
- Plugin and builtin skills appear with the external ones, labelled with their origin, because they are third-party skills that happen to live outside the repository.
- The SessionStart pointer now groups the skills (`core …; external …; local …`) instead of listing the folders.
