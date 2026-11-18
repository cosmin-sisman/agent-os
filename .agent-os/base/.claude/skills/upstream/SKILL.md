---
name: upstream
description: Propose an improvement to agent-os itself, as an issue on its public repository, with everything private removed and the exact text approved first. Use when someone says agent-os should do something better, when a lesson is about agent-os rather than the project, or when a doctor finding or a skill failure comes from the package.
argument-hint: "<what agent-os should do better>"
---

# /upstream: improve agent-os from here

Request: $ARGUMENTS

This project has `upstream.enabled: false`: the draft is saved to a local file and nothing is sent.

## 1. Is it about agent-os?

Only package problems go upstream: a skill, a command, a rule, a template, the documentation. A problem with this project's own code or conventions is a lesson or a ticket here.

## 2. Draft

```
agent-os upstream draft --title "<one line>" --what "<what happened or is missing>" --proposal "<what agent-os should do>" --where "<the skill or agent-os command>" --key <config.key>
agent-os upstream draft --lesson <id>                # from a lesson card
```

The draft is built from a whitelist: the agent-os version, the profile, the skill or command, configuration key names (never their values), the OS and Node versions, and your text with project names, code, paths, links, people and secrets removed. Upstream issues are in English, whatever this project's languages are.

## 3. Show the exact text

Show the person the whole draft and what was removed. If a similar upstream issue exists, propose a 👍 or a comment there instead of a new issue.

## 4. File, only with approval

```
agent-os upstream draft … --file --approve
```

Run this only after the person has read and agreed to the exact text. The URL is recorded in the journal and, for a lesson, on its card (`upstream:`), so /retro can retire the workaround once a release fixes it.

## 5. Learn

If the same package gap keeps coming up, say so in the upstream issue instead of filing another one.
