---
name: ingest-docs
description: Turn existing specifications into epics and sub-issues, each citing the section it came from, after reporting where the specifications contradict each other and asking the person how to resolve it. Use for a spec-first repository, or when someone asks to create the issues from the docs.
argument-hint: "[file or folder]"
---

# /ingest-docs: from specifications to issues

## 1. The plan

```
agent-os ingest plan [docs/ specs/ …]
```

It reads the Markdown specifications. Each top section that holds requirements (list items, "must / should / shall" sentences) becomes an epic, and each requirement a sub-issue. Every item records its file, line and section. Nothing is created yet.

## 2. Contradictions first

When two statements are about the same thing but disagree (different numbers, or one negated), the plan lists them and exits 1. **Ask the person about each one before creating any issue**: keep the first (`a`), keep the second (`b`), or both when they do not conflict. Suggest fixing the specification that lost, in the same {{vocab.changeRequest}} as any other doc change.

## 3. Review the epics with the person

Go through the epics and their sub-issues. Merge requirements that are one piece of work, drop the ones that are not work (context, wishes), and say which milestone they belong to.

## 4. Create

```
agent-os ingest apply --resolve c1=b --milestone "<milestone>"
```

Each issue's body cites its source section with a link to it. The milestone is created when it does not exist. Then complete each issue the way /ticket does: area labels, priority, test scenarios (`agent-os test plan <n>`).

## 5. Learn

If the person had to merge or drop many generated issues, capture why with `agent-os lessons add`: the specifications or the reading need a rule.
