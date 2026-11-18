---
type: note
refs: ["#78"]
areas: [stack]
author: cosmin-sisman
---

# Stack import from builder sheets: bounded xlsx reader, overlay suggestions

`stack import` reads a stack builder sheet (xlsx or csv) into stack.yaml: an en or ro header row, names mapped to catalog ids regardless of case and diacritics, statuses from either language, and unknown technologies turned into overlay suggestions (--overlay writes them, never replacing an id). The xlsx reader is bounded because the file comes from outside. It has limits on entries, unpacked sizes and compression ratio; it refuses unsafe entry paths and enforces the declared size while inflating, so a lying header cannot unpack more. It reads values only: formulas give their cached value and are never evaluated. Tests build their own spreadsheets in memory, so no binary fixture is committed. The user's own builder sheet was used only as a local check: 15 layers, all mapped, statuses right, and the result passes `stack check`.
