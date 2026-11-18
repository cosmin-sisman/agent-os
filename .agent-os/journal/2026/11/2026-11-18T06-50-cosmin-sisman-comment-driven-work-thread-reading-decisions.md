---
type: note
refs: ["#34"]
areas: [collab]
author: cosmin-sisman
---

# Comment-driven work: thread reading, decisions quoted, reply language

Conversations drive the work: `agent-os thread <N>` reads an issue or change request before acting. It shows the participants, the language and the decisions made in comments, quoted verbatim and never paraphrased. `journal add --thread` writes those decisions into the implementing change request's entry, with author, date and link. `pr reply` and `issue comment` answer in the language of the comment they answer: another language is refused, and ro is made ASCII. They also take the @ off handles that are not participants, so an invented name pings no one. Decision and language detection is word-based and deterministic: no model call, and the same answer on every laptop.
