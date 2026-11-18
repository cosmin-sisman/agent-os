---
type: note
refs: ["#60"]
areas: [distribution]
author: cosmin-sisman
---

# Guides per profile, with a commands reference and skill catalog generated from what ships

`docs/guides/` has a quick start for each profile (greenfield, spec-first, active, maintenance), an index and an FAQ. `npm run docs` generates `docs/reference/commands.md` from the registry and each command's usage and options, and `docs/reference/skill-catalog.md` from the core skills' front matter. A test fails when either is out of date, when a guide shows a command or option that does not exist, or when the greenfield guide's commands stop working end to end: they are run in order in an empty repository. Only en: the issue does not ask for ro.
