# Hooks

agent-os plugs into Claude Code through one command per event in `.claude/settings.json`:

```bash
agent-os hook --print-settings     # the block to put under "hooks"
```

Each entry calls `agent-os hook <Event>` (SessionStart, PreToolUse, PostToolUse, Stop) with no shell syntax, so the same settings work whether Claude Code runs commands through bash, zsh or PowerShell. Claude Code sends the event as JSON on stdin; the runner runs every handler registered for it and answers in the hook JSON format:

| Handler result | Becomes |
|---|---|
| a guard refuses (PreToolUse) | `hookSpecificOutput.permissionDecision: "deny"` with the reason |
| a warning or reminder | `systemMessage`, shown to you |
| context (SessionStart) | `hookSpecificOutput.additionalContext` |

**A hook never breaks a session.** Every handler runs isolated, with a timeout. A handler that crashes or hangs is reported once per session and then skipped. Bad input or an invalid configuration produces a warning and exit code 0. Only guards can refuse a command; any other handler can only warn.

## Guards

Guards check every shell command an agent wants to run (`Bash`, `PowerShell`). Command lines are split on `&&`, `||`, `;`, `|` and new lines, never inside quotes, so `git commit -m "about --no-verify"` is fine while `git add -A && git commit --no-verify` is refused.

Built in, on unless listed in `guards.disable`:

| Id | Refuses |
|---|---|
| `no-verify` | `--no-verify` on `git commit`, `merge`, `push`, `pull`, `rebase`, `am`, `cherry-pick`, `revert` |
| `commit-n` | `git commit -n` |
| `hooks-path` | changing `core.hooksPath`, which turns git hooks off |

Projects add rules in `agent-os.json`:

```json
"guards": {
  "rules": [
    { "id": "db-reset", "type": "require-env", "pattern": "^npm\\s+run\\s+db:reset\\b", "env": "DB_RESET_OK",
      "message": "the local database is shared; agree first, then run DB_RESET_OK=1 npm run db:reset" },
    { "id": "heavy", "type": "min-free-memory", "pattern": "^npm\\s+run\\s+(build|test:e2e)\\b", "message": "builds and browsers need memory" },
    { "id": "no-force-main", "type": "forbid-pattern", "pattern": "^git\\s+push\\s+(-f|--force)\\b.*\\bmain\\b" }
  ],
  "disable": []
}
```

| Type | Refuses when |
|---|---|
| `forbid-flags` | the command matches `pattern` and has one of `flags` as a separate word |
| `forbid-pattern` | the command matches `pattern` |
| `require-env` | the command matches and `env` is set neither inline (`VAR=1 cmd`) nor in the environment |
| `min-free-memory` | the command matches and free memory is below your `machine.minFreeMb` (MemAvailable on Linux) |

## Adoption mode

`"adoption": { "warnOnlyUntil": "2026-12-31" }` turns guard refusals into warnings until that date, so a team can see what the guards would stop before they start enforcing it.

## The SessionStart context

Two handlers give each session its bearings, within one budget (`contextBudgets.SessionStart`, 1.5 KB by default):

| Handler | Lines (most important first) | Needs |
|---|---|---|
| `session` | your branch and its issue (or, on the integration branch, a pointer to `/start` and `/next`); the lessons for the files you changed (at most 2); how many lessons wait in the inbox; the skills installed here | nothing: it reads the working tree |
| `session-remote` | the issue's title and state; issues assigned to you; reviews requested from you (at most 5 each) | the platform login; it gives up after 3 seconds |

- **Budget:** when the lines don't fit, the least important ones are dropped first, so the injection never exceeds the budget.
- **Offline:** without the platform (no network, no login, too slow), only the local lines are injected. A context handler that fails is left out quietly, with no warning, and the session is never blocked.
- **Privacy:** nothing is taken from `.agent-os/local.json` or from environment variables.

## The on-edit standards reminder

The `standards` handler runs on PostToolUse for Edit, Write and MultiEdit (the matcher already in the hooks block). It reads the edited file and checks only what the edit added:
- a `TODO`, `FIXME` or `XXX` without `#N`, naming its line;
- a comment not in English (unless `languages.codeComments` is `ro`);
- a file over `standards.maxFileLines` (500 by default);
- for a new file (Write), a missing header.

It answers with `additionalContext` for the agent and never blocks the edit. It has an 800 ms timeout and reminds each finding once per session. `doctor` runs the same checks, as warnings, on the files the branch changes (`standards`), and checks headers on new files (`headers`).

## The Stop reminder on test gaps

The `test-gaps` handler runs on Stop, when the agent finishes a turn. It names the changed source files with no changed test (the same list as `agent-os test gaps`, against `origin/<branches.integration>`) as a `systemMessage`. It never blocks the stop: it returns no decision, says nothing when `stop_hook_active` is set, and names a given set of gaps once per session, so it cannot loop. With no gaps, or no base to diff against, it stays silent. The gate also lists the gaps in its result and as a warning (never a failure).
