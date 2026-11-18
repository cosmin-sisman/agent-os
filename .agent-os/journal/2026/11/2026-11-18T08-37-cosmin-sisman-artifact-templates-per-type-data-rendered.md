---
type: note
refs: ["#86"]
areas: [artifacts]
author: cosmin-sisman
---

# Artifact templates per type, data rendered as text, release report from the journal

Artifact types get templates: one shared, theme-aware page that renders a data.json, and a skeleton per type in en and ro. `artifact new` builds the page at once; `--from-journal` fills a release report from the journal between two dates. Data is treated as untrusted: the renderer only uses textContent, and the embedded JSON now escapes every "<", not only "</", so no value can open markup inside the data block.
