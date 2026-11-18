---
type: note
refs: ["#105"]
areas: [cli]
author: cosmin-sisman
---

# /audit: subject, lenses in separate subagents, findings with evidence

`agent-os audit plan` detects the subject (idea, spec, project, release, problem, system), and the person confirms it. The plan picks the lenses by preset and writes one brief per lens. A problem runs only the lenses of the layers it involves. The /audit skill runs each lens in its own subagent so that the lenses do not anchor on each other. `agent-os audit merge` turns their answers into one report: a finding without evidence becomes a question, duplicates across lenses merge, severity and confidence stay separate, and strengths are kept. An audit creates nothing on the platform.
