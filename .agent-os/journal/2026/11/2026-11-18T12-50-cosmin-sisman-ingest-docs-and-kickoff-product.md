---
type: note
refs: ["#53"]
areas: [init]
author: cosmin-sisman
---

# /ingest-docs and the product step of /kickoff

`agent-os ingest plan` reads Markdown specifications into epics (top sections) and sub-issues (list items and must/should/shall sentences). Each one cites its file, line and section, and links to the anchor. Statements about the same thing that disagree (different numbers, or one negated) are reported. `ingest apply` creates nothing until the person resolves each one, and leaves out the overruled statement. /kickoff, from #80, was extended rather than dropped. It now starts with a product interview that writes `docs/product.md`, then the stack steps, then the first milestone and issues through `ingest`.
