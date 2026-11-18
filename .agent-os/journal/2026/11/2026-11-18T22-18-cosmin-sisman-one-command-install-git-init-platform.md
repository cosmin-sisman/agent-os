---
type: decision
refs: ["#264"]
areas: [distribution, cli]
author: cosmin-sisman
---

# One-command install: git init, platform and project, init and personal settings

`agent-os install` is the one-command start, for anyone who tries agent-os in a fresh folder:
- It asks the chat language once.
- When the folder is not a repository, it offers `git init -b <integration>`.
- With no origin remote, it asks the platform, the host (empty means the cloud one) and the project. It offers to create the repository, private, through the platform CLI; the confirmation defaults to no. Or it takes an existing owner/name and adds it as origin.
- It then runs the full init and the personal settings (sessions, machine limits) and prints one report. The installed files are collapsed into one line, and the report ends with the next steps by profile.

The bare `agent-os` runs install only on a terminal, in a folder without agent-os.json; elsewhere it prints help as before. Scripted runs (`--yes`, or no terminal) never create anything on a platform. With no remote and no `--platform`, they fail before writing anything, even before `git init`.

Choice: install reuses init's `full` and `personal` functions, and gathers their `ctx.output` calls into one report. A second implementation of the init flow would drift from init. What differs by platform (cloud host, CLI, login, `repo create`) lives in src/platform/create.mjs, so install stays free of platform-name branches (the architecture rule). `systemGh` and `systemGlab` accept an `env`, so GH_HOST and GITLAB_HOST reach a self-managed host.
