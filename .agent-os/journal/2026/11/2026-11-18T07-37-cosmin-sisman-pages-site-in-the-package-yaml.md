---
type: lesson
refs: ["#84"]
areas: [artifacts]
author: cosmin-sisman
---

# Pages site in the package; YAML hashes must be quoted

The artifact site ships in the package: `agent-os artifact site` builds every valid artifact plus a self-contained index by type, date, area and linked item, with verification status, into an output folder outside artifacts/, by default the ignored cache. An opt-in workflow (artifacts.pages) publishes it on GitHub or GitLab Pages and rebuilds living artifacts first; a template that renders empty is now skipped, which is how optional files are installed. This repository's own scripts/site and pages.yml were left untouched: its published site stays byte-identical and merging triggers no deploy.

Lesson: hashes written to YAML must be quoted. An unquoted all-digit sha256 is read back as the number 0, and one like 12e45… as a float; build.mjs wrote them unquoted. It now quotes them, and the test fixtures do too.
