---
type: decision
refs: ["#38", "#39", "#41", "#27"]
areas: [skills]
author: cosmin-sisman
---

# Skill registry: one JSON per skill, core entries installed

The registry format, its schema, `agent-os skill register|check`, and doctor's consistency check built on it.

Decisions:
- One file per skill keeps registrations from conflicting. A test merges two branches that each register a skill and checks there is no conflict, which covers the issue's scenario.
- Core skills get their registry entries from the install plan (`origin: core`, `managed: true`, with the version and a one-line description from the front matter). The registry therefore describes every skill on disk, and `agent-os skills` (#41) can render all three tables from it.
- Plugin and builtin skills are registered without folders, so slots can name them and doctor accepts them.
- An external skill must pin its source to a commit or tag.
- doctor fails on any mismatch: an unregistered folder, an entry without its folder, or an invalid entry. A folder managed by agent-os that has no entry yet is only a warning (an older install), fixed by `update`.
- Adding, updating and removing vendored skills stays with #39.
