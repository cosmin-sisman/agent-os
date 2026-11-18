---
type: note
refs: ["#262"]
areas: [docs]
author: cosmin-sisman
---

# README install steps and a usage guide with real CLI samples

The README now starts from the published package (0.1.2 on npm), not from a target CLI. The Quick start covers the requirements, npx and a global install, a new project, an existing repository (`init --detect`, the profiles, `--methodology`), GitLab self-managed, the languages and updating. The design-phase notice is gone, and the roadmap marks the milestones whose issues are all closed.

The new usage guide (docs/guides/usage.md) covers the daily loop with what each step enforces, one section per installed skill, choosing a profile, eight short use cases and troubleshooting. Every CLI sample in it is real output from agent-os 0.1.2, trimmed: from a throwaway repository, or read-only commands and dry runs on this one. Agent replies are marked as examples. The guides' command-check test now covers usage.md, and a new test requires a section for every core skill.

Two 0.1.2 problems turned up while collecting output; neither is fixed here:
- `discover plan` fails on this repository and prints the whole GitHub API response as the error (about 1 MB);
- `upstream draft` keeps what comes before a colon on purpose (a title is one clause). With an `<Area>: <problem>` title, though, only the area is left: "Doctor: name the missing hook" became "Doctor".
