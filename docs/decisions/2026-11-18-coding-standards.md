# Coding standards, always on, with a decision procedure for alternatives

Status: accepted

## Context
Agents write a lot of code. Without a standard that is always present, style drifts between sessions, comments switch language, files lose their headers, and the first idea is implemented even when a simpler or faster one fits better.

## Decision
- Code is in English (identifiers, comments, logs, commits); `ro` comments only when a team sets the `codeComments` area explicitly.
- Every file has a 1–3 line header; public contracts are documented; comments explain why.
- Clarity first, optimization where it is measured or obviously needed, never at the cost of clarity without a written reason.
- When several solutions fit, the agent names the candidates, compares them on fixed criteria, picks one with a one-sentence reason (a decision record if it is hard to reverse) and implements only that one.
- Activation is automatic: an always-loaded rule plus stack-scoped language rules, a PostToolUse reminder on edits, a standards pass in `/pr` and `/mr` through the `standards` slot, deterministic checks in `doctor --ci`, and `/standards` on demand.

## Consequences
Code stays consistent across people and sessions and is easy to search. The checks remind rather than block locally, and CI enforces the deterministic part.
