---
type: decision
refs: ["#101", "#102", "#103", "#24"]
areas: [standards]
author: cosmin-sisman
---

# Standards: a core rule always loaded, language rules scoped by stack paths

`.claude/rules/standards.md` (en/ro) in core, plus `.claude/rules/stack/<language>.md` chosen from stack.yaml.

Decisions:
- Language rules are scoped with Claude Code's `paths:` front matter, using the chosen layers' paths, so a Python rule never sits in a TypeScript session. That covers the issue's scenario.
- The catalog is the bridge: layer → technology → language. Its `aiFriendly` score (≤ 2, taken from the technology or the language, whichever is lower) adds "Read the docs first" naming the technology.
- Three lessons in this repository's inbox were marked "upstream #101" (file paths from import.meta.url, never import from a test file, quote identifiers in YAML). They are now rule lines: the first two in the TypeScript and JavaScript rules, the YAML one in the core rule and the YAML rule. Moving them out of the inbox is a /retro decision for the owner.
- Each rendered rule is tested to be under the 6 KB budget in both languages. The doctor budget glob now covers `.claude/rules/**/*.md`.
- The /standards skill (#102) and the on-edit checks (#103) stay separate.
