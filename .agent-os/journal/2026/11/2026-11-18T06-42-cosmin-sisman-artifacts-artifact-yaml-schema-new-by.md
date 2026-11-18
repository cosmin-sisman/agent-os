---
type: note
refs: ["#82"]
areas: [artifacts]
author: cosmin-sisman
---

# Artifacts: artifact.yaml schema, new by type, list, check and log

Artifacts get a schema and a CLI: artifact.yaml is validated (id equals the folder and starts with a real date; type, kind and status from fixed lists, with the closest match for typos; sources with sha256), `artifact new <type> <slug>` scaffolds a self-contained page with sections for the type, `list` shows problems and stale sources, `check` fails on problems, and `log` reads the folder's git history. A test keeps this repository's artifacts valid.
