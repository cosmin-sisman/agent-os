---
type: note
refs: ["#109"]
areas: [security]
author: cosmin-sisman
---

# Security pass: layer checklists, findings with fix and reason, scanner reports read only

The security pass picks the OWASP ASVS items for the layers a change touches, and flags what the changed files show in their text: missing rate limits and webhook signatures, string-built SQL, raw HTML, public secrets, unverified tokens, weak cookies, unpinned or root images, open CIDRs, CI errors. Each finding carries the checklist item, the fix and the reason, and the rest of the checklist is listed to check by hand. Scanner results come only from the reports the project's own tools write (SARIF, gitleaks JSON). agent-os never installs or runs a scanner and never copies a secret value. /env reports the scanners the team listed but the laptop lacks.
