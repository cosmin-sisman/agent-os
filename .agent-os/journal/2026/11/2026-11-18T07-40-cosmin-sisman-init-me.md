---
type: decision
refs: ["#99", "#4", "#49"]
areas: [i18n, init, collab]
author: cosmin-sisman
---

# init --me: personal setup that never touches a committed file

`agent-os init --me` asks the chat language first, then sessions (how many in parallel; with more than one, whether one coordinates the others and the first dev port), then the free-memory floor. It writes only `.agent-os/local.json`. Questions go through a small injectable prompt helper (`src/cli/prompt.mjs`): a terminal in the executable, scripted answers in tests, defaults in CI or with `--yes`.

Decision, prompted by the orchestrator's review: personal commands never edit `.gitignore`, because it is committed. When the personal files are not ignored, they go to `.git/info/exclude` (local to the clone), and the output asks the team to add them to `.gitignore`. This also changes `config set` from #4, which used to append to `.gitignore`. Editing `.gitignore` is now reserved for the full init (#49), a team action. A test on a real git repository checks that `git status` stays empty.
