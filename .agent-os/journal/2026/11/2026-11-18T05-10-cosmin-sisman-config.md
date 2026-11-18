---
type: decision
refs: ["#4"]
areas: [cli, i18n]
author: cosmin-sisman
---

# Configuration: one schema, two files, keys that know where they belong

`src/config/schema.mjs` is the single definition behind validation, defaults, the published JSON Schemas (`schema/*.schema.json`) and the key table in `docs/reference/configuration.md`. Tests fail when any generated file falls behind.

Decision: every key belongs to exactly one file. Personal keys (`languages.chat`, `machine.*`, `orchestrator`) live only in `.agent-os/local.json`, and everything else only in `agent-os.json`. Instead of a merge that silently lets a personal file override team values, a key in the wrong file is an error that names the right file. `agent-os config set` picks the file from the key and adds the `.gitignore` entries the first time it writes a personal value.
