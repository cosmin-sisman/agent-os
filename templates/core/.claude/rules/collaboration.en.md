{{! area: docs }}
# Working together

Several people work in this repository, each with their own agent sessions on their own laptop. {{vocab.platform}} is the only shared state: issues, {{vocab.changeRequests}}, comments, the board and git. Nothing coordinates through a file one person keeps locally.

## Claiming work

- Work on an issue only after claiming it: `agent-os start <n>` assigns you and creates the linked branch. Claim before the first edit, not after.
- One {{vocab.changeRequest}} closes one issue. Bigger work gets sub-issues, each claimed on its own.
- Check what others are changing: `agent-os start` and `agent-os pr preflight` name overlapping work. On overlap, talk to the author before you both go further.

## Someone else's issue

- Never take an issue assigned to someone else, and never push to their branch. Ask in the issue first ("@name, may I take this, or pair on it?"). Use `agent-os start --force` only after they agree.
- Never update another person's branch with the base (merge or rebase) unless they ask. `/ship` sends a branch that is behind back to its author.

## Comments

- Read the whole thread before acting on an issue or a {{vocab.changeRequest}}: `agent-os thread <n>` shows its participants, its language and the decisions made in comments.
- Answer in the language of the comment you answer. New comments use the issues language (**{{lang.issues}}**) and the {{vocab.changeRequests}} language (**{{lang.prs}}**).
- Say what you did and what is left. A decision made in a thread is quoted verbatim in the journal entry of the {{vocab.changeRequest}} that implements it (`agent-os journal add … --thread <n>`).
- @mention only people taking part or asked to: `agent-os issue comment` and `agent-os pr reply` take the @ off any other handle and refuse a reply in another language than the comment's.

## Personal and team state

Committed (team agreement or history, one file per entry, so no conflicts): `agent-os.json`, `.claude/` rules and skills, `.agent-os/journal/`, `.agent-os/lessons/`, `.agent-os/registry/`, `.agent-os/lock.json` and `.agent-os/base/`.

Never committed (personal, per laptop): `.agent-os/local.json`, `.agent-os/cache/`, `.claude/settings.local.json`, `.claude/worktrees/`, secrets and tokens. `agent-os doctor` fails when git tracks any of them.

## CI is the guarantee

Local hooks help, but someone can skip them. The required checks (`ci`, `agent-os/loop`) run on every {{vocab.changeRequest}} and cannot be skipped. Never work around a failing check. Fix the cause, or ask in the {{vocab.changeRequest}}.
