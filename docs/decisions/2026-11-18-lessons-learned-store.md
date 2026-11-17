# Lessons learned as a first-class store, recalled automatically

Status: accepted

## Context
Lessons written into one memory file are hard to find again, conflict when several people write them, and rarely reach the session that needs them. Lessons absorbed into rules are useful but lose their origin. Specific lessons ("this provider rate-limits batch calls above 50") are too narrow for a rule, yet expensive to relearn.

## Decision
- Lessons live in `.agent-os/lessons/{inbox,active,retired}/`, one file per lesson, with `areas`, `paths`, `keywords`, `source`, `confidence`, `recalled`/`followed` counters and `promotedTo`.
- Capture is automatic (the Learn step of every core skill, the PR's `## Lessons` section, repeated review findings) and on demand (`/lessons add`).
- Recall is automatic: `/start` and `/pr` run `agent-os lessons recall` on the issue's areas, the touched paths and keywords, within a token budget, and state which lessons they follow.
- `/retro` triages the inbox, updates counters from the journal (one writer, so no conflicts), promotes lessons that keep being followed into rules, and retires stale ones.
- `/lessons` offers `add`, `recall`, `search`, `review`, `promote`, `retire`.

## Consequences
The loop reaches the moment of work instead of waiting for someone to reread a file. Lessons keep their origin even after promotion, and the retired folder records what the team stopped believing.
