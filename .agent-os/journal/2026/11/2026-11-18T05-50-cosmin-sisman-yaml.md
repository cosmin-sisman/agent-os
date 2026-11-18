---
type: decision
refs: ["#63"]
areas: [cli]
author: cosmin-sisman
---

# A strict YAML subset, one parser for the whole package

`src/yaml/yaml.mjs` parses and emits the subset documented in `docs/reference/yaml.md`. It parses every file in catalog/, examples/ and artifacts/, and they all round-trip. Constructs outside the subset (tabs, anchors, aliases, tags, documents, block scalars, merge keys, duplicate keys) fail with file:line:column instead of being guessed.

Decision: booleans are only `true`/`false` (YAML 1.2 core), so `no` or `on` in a stack file stay strings, the classic "Norway problem". The site builder's ad-hoc artifact.yaml reader is replaced by this parser, leaving one YAML implementation in the package.
