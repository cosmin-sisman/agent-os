---
type: decision
refs: ["#123", "#89", "#100", "#104", "#107", "#112", "#119", "#120", "#121", "#122"]
areas: [platform, audit, standards, security, system, process]
author: cosmin-sisman
---

# GitHub and GitLab, audit, coding standards, security and the system map join the design

Owner requirements recorded:
- choose GitHub or GitLab (including self-managed and on-premise), each with its own conventions and install route, everywhere including the repository About (§20);
- a versatile `/audit` for ideas, ongoing and finished projects, specific and complex problems, through different perspectives (§21);
- the chat language chosen separately at install (`init --me` for new teammates);
- an always-on coding standards skill that also chooses between alternative solutions (§22);
- an autonomous security skill that follows relevant advisories, checks code and prepares scenarios (§23);
- awareness of monorepos, microservices, modules, integrations, API communication, internal versus public apps, routes and Swagger (§24);
- the package's own principles applied to this repository.

Hygiene applied on this repository: area labels on every epic, retrofit issues #119–#122 for work done without an issue (closed with their commits and PR), labels on #88, progress comments on renamed or partly advanced issues, and two lessons triaged and promoted into AGENTS.md (`.agent-os/lessons/active/`). Every open issue was checked: none is done, so all stay open.
