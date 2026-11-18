---
type: note
refs: ["#115"]
areas: [system]
author: cosmin-sisman
---

# System checks: structural findings in doctor and the security pass

System checks turn the system map into findings: spec drift, public routes with no visible authentication, internal components a platform file deploys publicly, webhooks without signature verification, component and module cycles, deep imports, databases shared by independent services, and outgoing calls without a timeout. Each finding names the component, the file and the fix. They run in doctor once system.yaml exists, and in pr preflight for the files a change touches. A missing auth marker is a warning, because authentication can live in middleware the text does not show. An unsigned webhook or an internal component deployed publicly fails. Lazy import() calls are left out of the cycle check: they cannot form a load-time cycle, and this repository's command registry would otherwise be reported.
