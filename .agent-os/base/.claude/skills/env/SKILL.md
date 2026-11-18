---
name: env
description: Check that this laptop and this repository have what the project needs (MCP servers, command-line tools and their versions, platform token scopes, environment variables) and help fix what is missing. Use when a tool or MCP server is missing, a skill fails for an environment reason, someone joins the project, or before a release.
argument-hint: "[fast | ci]"
---

# /env: what the project needs, on this laptop and in the repository

Mode: $ARGUMENTS (empty = full check)

## 1. Run the check

```
agent-os env --json
```

Use `--fast` for the repository side and variables only, or `--ci` for the repository side only. The exit code is 0 when nothing fails (warnings are fine) and 1 when something fails.

## 2. Explain

For each finding that is not `ok`, say in one line what it means for the work, in the chat language. Group them as **repository** (shared, fixed by a pull or merge request) and **this laptop** (personal, fixed by the person).

## 3. Repair, only with consent

- Repository findings (a server missing from `.mcp.json`, a literal secret in it): propose the change as a normal branch and pull or merge request. A literal secret must also be **rotated**: say so plainly, and never repeat or reconstruct its value.
- Laptop findings: show the exact `fix` command from the report and run it only when the person agrees. Never install an MCP server, change token scopes or set a variable without asking.
- Never print, log or paste the value of a token or a secret variable. Speak only about names, presence, scopes and where a value comes from.

## 4. Check again

Run `agent-os env` again and report the summary line before and after.

## 5. Learn

A missing requirement that surprised the team (a tool nobody listed, a scope that a skill needed) becomes a `requires` entry in `agent-os.json` through a pull or merge request, plus a lesson in `.agent-os/lessons/inbox/`. If there is nothing to learn, say so.
