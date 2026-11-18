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
