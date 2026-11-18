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
