---
type: note
refs: ["#73"]
areas: [stack]
author: cosmin-sisman
---

# Catalog: one loader with project overlays, validated in CI

The catalog has one loader (src/stack/catalog.mjs) that merges the project's overlays from .agent-os/catalog/. A new id is added; an existing id gets only the fields the overlay sets, so a team can confirm a provider's EU regions without copying the entry. Validation checks unique ids, references that resolve against the merged catalog (so overlays may reference each other), both en and ro on every localized text, and strict ASCII for ro, stricter than the diacritics check. Every problem names the file and the id. CI runs `agent-os stack catalog check` in the test job, and a test asserts the shipped catalog is clean.
