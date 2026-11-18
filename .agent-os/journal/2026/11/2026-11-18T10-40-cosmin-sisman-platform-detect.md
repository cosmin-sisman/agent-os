---
type: decision
refs: ["#90", "#49"]
areas: [platform]
author: cosmin-sisman
---

# Platform detection

`agent-os platform detect` reads the git remote. It recognizes github.com and gitlab.com directly, and probes any other host anonymously (`/api/v3/meta` for GitHub Enterprise Server, `/api/v4/version` for GitLab). Tried against a real self-managed GitLab (gitlab.gnome.org): it is recognized from GitLab's 401 answer without a token.

Decisions:
- An unknown host is reported with what it answered and the command exits 1. Nothing is guessed, because a wrong platform would send every later command to the wrong API.
- Credentials embedded in a remote URL are never kept: parsing keeps only host and project. A test puts a fake token in the URL and checks agent-os.json and every output.
- Writing to agent-os.json asks first (or `--yes`). The full `init` (#49) will call the same detection as one of its steps.
