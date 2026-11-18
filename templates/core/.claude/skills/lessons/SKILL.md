---
name: lessons
description: Capture, recall, search and triage lessons learned. Use when something went wrong or took long and should not happen again, when someone asks "what do we know about…", before working in an unfamiliar area, or to triage the lessons inbox without waiting for /retro.
argument-hint: "add | recall | search <words> | review"
---

# /lessons: what the project has learned

Request: $ARGUMENTS

Lessons are written in **{{lang.docs}}**{{#if lang.docs == "ro"}} (Romanian without diacritics){{/if}}.

## Capture (`add`)

Only lessons that would change what someone does next time. "Be careful" is not a lesson; "quote hex colors in YAML, `000000` parses as a number" is.

```
agent-os lessons add "<the lesson in one sentence>. <Why.> <One example.>" --area <area> --path "<glob>" --keyword <word> --source "<issue, PR, review comment or incident>"
```

- `--path` globs and `--keyword`s decide when it comes back: pick the files where the mistake would happen again.
- It goes to the inbox. Tell the person, in one line, what you captured.

## Recall (`recall`)

```
agent-os lessons recall --issue <n>       # its areas, the paths and words it mentions
agent-os lessons recall --changed         # the files changed on this branch
agent-os lessons recall --path <p> --area <a>
```

At most three cards come back, best match first, within a small budget. Say which ones you follow and follow them. /start and /pr do this on their own. Recall never changes a card: the counters belong to /retro.

## Search (`search`)

`agent-os lessons search <words>` searches the active cards and the inbox (`--all` includes retired ones).

## Triage (`review`)

`agent-os lessons review` lists the inbox. For each card, propose one of these and do it when the person agrees:
- **accept**: `agent-os lessons accept <id> --as <short-slug>` (it becomes active and is recalled);
- **promote**: it belongs in a rule or a skill. Make that change in a {{vocab.changeRequest}}, then `agent-os lessons promote <id> --to "<file: section>"`;
- **retire**: it is no longer true, or is a duplicate: `agent-os lessons retire <id> --reason "<why>"`.

## The Learn step

Every skill ends with a Learn step: when something went wrong, was refused or took long, capture it here. That is how the system keeps up with the project.
