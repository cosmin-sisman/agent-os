# Managed files

Everything agent-os installs into a project is **managed**: updates can reach it, and they never destroy what the team changed. Decision: [managed files and the lock](../decisions/2026-11-18-managed-files-and-lock.md).

## What gets managed

| Kind | Lock key | What agent-os owns |
|---|---|---|
| file | `.claude/rules/git.md` | the whole file |
| block | `AGENTS.md#core` | only the text between `<!-- agent-os:begin core -->` and `<!-- agent-os:end core -->`; everything around it stays byte for byte |
| hooks | `.claude/settings.json#hooks` | only the hook entries whose command runs `agent-os hook`; every other hook, permission and setting is kept |

For each item, `.agent-os/lock.json` records the package version and the sha256 of what was installed, and `.agent-os/base/` keeps that content as the merge base. Both are committed.

## How an update treats an item

| Local state | What happens |
|---|---|
| missing, never installed | installed |
| present, never managed, equal to the new content | adopted |
| present, never managed, different | left alone; the proposal goes to `<path>.rej` |
| equal to the base (unmodified; CRLF counts as equal) | replaced by the new version |
| edited locally | three-way merge (base, local, new); changes to different lines are all kept |
| edited where the new version changed too | **conflict**: the local file is untouched, `<path>.rej` holds the merged text with `<<<<<<< local` / `>>>>>>> agent-os <version>` markers, the command exits 1, and the next update tries again |
| deleted locally | left deleted and reported |

## Commands

```bash
agent-os eject .claude/rules/git.md      # stop managing it; the file stays as it is
agent-os eject AGENTS.md#core            # one block (or path#hooks)
agent-os update --relock                 # rebuild lock.json from .agent-os/base/ after a merge conflict in it
```

The full `agent-os update` flow (plan, branch, migrations, PR) is #68.
