---
type: note
refs: ["#75"]
areas: [stack]
author: cosmin-sisman
---

# Areas from the stack: labels, PR labels, recall, overlap, CODEOWNERS

Areas now come from the stack map. Each layer in use becomes an area:<layer> label (zona:<layer> in ro, scoped where the platform scopes labels), and setup creates it with the "complete, don't replace" rule shared with the core labels. The label entries go through one renderer, so core and generated labels behave the same. Layer paths map changed files to areas: pr create labels by them, lessons recall matches on them, and overlap names them. Layer owners produce a CODEOWNERS block. Managed blocks gained #-comment markers for non-Markdown files, so the block mechanism (three-way merge, .rej on a hand-edited block) applies to CODEOWNERS unchanged.
