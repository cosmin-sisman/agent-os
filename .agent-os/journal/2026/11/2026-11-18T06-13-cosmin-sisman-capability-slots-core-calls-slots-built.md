---
type: decision
refs: ["#40", "#38", "#15"]
areas: [skills]
author: cosmin-sisman
---

# Capability slots: core calls slots, built-ins by default

Slots and their defaults, wired into the templates, init, the install plan, doctor and /pr.

Decisions:
- Seven slots core uses. `review` and `security-review` default to the Claude Code built-ins of those names; the others default to none. Templates read the effective bindings, so swapping a design skill is a single config line, the acceptance criterion; a test renders /pr with and without a ui-design binding.
- init writes all seven, bound or null, so a project sees every choice. doctor warns about a slot left undecided and about a binding to a skill that isn't on disk or registered.
- The built-ins that are bound are registered with origin builtin by the install plan. Rebinding a slot drops that registration.
- An unbound slot is skipped, never a stop. With ui-design unbound, `pr preflight` on a UI change warns and continues (the issue's scenario), and the /pr skill says the UI was reviewed by hand.
