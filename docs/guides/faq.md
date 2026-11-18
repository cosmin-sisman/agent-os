# FAQ

**Does agent-os change my repository without asking?**
No. Commands that change something take `--dry-run`, plans are written to `.agent-os/cache/` for review, and anything filed on the platform (issues, comments) needs your confirmation or an explicit flag.

**What is committed and what stays on my laptop?**
`agent-os.json`, the rules, skills, hooks block and journal are committed. `.agent-os/local.json` (chat language, sessions, machine limits) and `.agent-os/cache/` are ignored. `agent-os init --me` touches only the personal file.

**Can the team write issues in Romanian and code in English?**
Yes. Each area has its own language: chat, issues, pull or merge requests, commits, branches, labels, milestones, releases, code comments, docs and the journal. Romanian is written without diacritics. See [languages](../reference/languages.md).

**GitHub or GitLab?**
Both, including self-managed GitLab. Features depend on what the platform supports, probed at run time, with a fallback when it does not. `agent-os platform` shows what was detected.

**Does it send my code anywhere?**
No. The only network calls are to your platform's API, and the advisory watch, which sends only package names and versions (off by default on a self-managed host). Scanners are never run by agent-os; it reads their reports.

**How do I stop agent-os managing a file?**
`agent-os eject <path>`: the content stays as it is, and updates leave it alone.

**How do I update?**
`agent-os update --plan` shows what changes, then `agent-os update` applies it on its own branch, as a change request.

**Something looks wrong.**
`agent-os doctor` checks the setup and suggests fixes; `agent-os doctor --fix` repairs what is mechanical.

**We use Codex or Cursor, not only Claude Code.**
AGENTS.md and the CLI work in any agent, and the platform checks (`agent-os/loop`, the gate, branch protection) enforce the flow in CI. The installed AGENTS.md block says how to run a skill: a request for `/<name>` means reading `.claude/skills/<name>/SKILL.md` and following it, and every step in it is an `agent-os` command.

Two parts work only in Claude Code, and `agent-os doctor` names them in an info note:
- **Hooks** (guards, session context, reminders). Other agents get the same rules later, at push time, from the required checks; no guard protects you while you edit.
- **Subagent fan-out** (`/audit` lenses, `/discover` areas). Other agents run the same briefs one after another.

See the decision on [other agents](../decisions/2026-11-18-other-agents-agents-md-first.md).
