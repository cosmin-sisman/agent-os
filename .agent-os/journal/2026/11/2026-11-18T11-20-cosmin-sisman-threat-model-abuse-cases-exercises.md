---
type: note
refs: ["#110"]
areas: [security, testing]
author: cosmin-sisman
---

# Threat model, abuse cases and tabletop exercises

The STRIDE threat model per layer is a living `threat-model` artifact with `stack.yaml` as a source. It goes stale when the stack changes and is refreshed by `stack set`, by `security threat-model`, and before a release (`release plan` lists it); SessionStart mentions it. `/test plan` adds "Given an attacker" scenarios for payments, auth, public API and personal data, read from area labels, the title and the Goal or Context section. The rest of the body is left out because words there are too often about something else. A fixed vulnerability starts with the bug regression scenario. `security exercise` walks a leaked key, a compromised account or a vulnerable dependency against the runbooks and proposes an issue for the gaps without filing it.
