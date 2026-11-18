---
type: decision
refs: ["#268"]
areas: [cli]
author: cosmin-sisman
---

# Arrow-key menus for interactive questions, line prompt as the fallback

On a real terminal, interactive questions are now menus: an arrow-key menu for a choice (↑/↓, j/k, number keys, Enter), a Yes/No toggle (←/→, or y/n to answer at once), and a typed line for free text with its default shown dimmed. The first question prints the header "agent-os setup", each question carries a step counter, and an answered question collapses to one ✔ line with the value. Choices have one-line descriptions: languages, profiles, methodology, platforms.

Choice: the menus live in src/cli/menu.mjs, behind the same `ask` every command already calls, so init, `init --me`, install and the other commands that ask got them without changes at the call sites. bin/agent-os.mjs hands over `io.terminal` only when stdin is a TTY with raw mode, outside CI. Everything else keeps the line prompt and the same answers. The menu also edits free text itself, rather than mixing readline.question with raw keypresses on the same stdin, which would echo keys twice.

The terminal is restored on every path: an answer, an error, and Ctrl+C, which exits 130 as "cancelled". NO_COLOR drops the colors but keeps the ❯ marker. A terminal that reports 0 columns falls back to 80.
