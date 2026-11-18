# From specifications to issues (spec-first)

For a repository with specifications and little code.

## 1. Install

```bash
agent-os init --profile spec-first --platform github --project <owner/name> --lang en --team --yes
agent-os init --me --chat en --yes
```

## 2. Read the specifications

```bash
agent-os ingest plan docs/
```

Requirements are the list items and the "must / should / shall" sentences of each section. Each top section becomes an epic, and each requirement a sub-issue that records its file, line and section. Nothing is created yet.

## 3. Resolve contradictions first

When two statements are about the same thing but disagree (30 minutes in one spec, 15 in another, or one negated), `plan` lists them and exits 1. Decide each one with the team, then create the issues:

```bash
agent-os ingest apply --resolve c1=b --milestone "<milestone>"
```

`a` keeps the first statement, `b` the second, and `both` means they do not conflict. Fix the losing specification too. `/ingest-docs` walks you through it.

## 4. The stack, when the specs name one

```bash
agent-os stack detect --write
agent-os stack check
```

Then follow the daily loop: `/next`, `/start <n>`, `/pr`, `/ship`.
