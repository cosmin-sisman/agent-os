---
name: audit
description: Audit an idea, a spec, this project, a release, a problem or a system through separate lenses (product, architecture, stack, code quality, security and privacy, performance and cost, delivery, process, operations), each in its own subagent, and merge the findings into one report where every finding has evidence. Use when someone asks for an audit, a review of an idea or a codebase, or "what is wrong with X".
---

# /audit: lenses, evidence, one report

## 1. The plan

```
agent-os audit plan "<what>" --json
```

`<what>` is an idea in words, a folder (`docs/`, `.`), `release`, an issue (`#N`) or a problem in words. The plan names the subject it detected and why, the lenses its preset picks and one brief per lens.

Confirm the subject with the person using the plan's `question`. When it is wrong, plan again with `--as <subject>`. Add or remove lenses the same way (`--lens <name>`, `--no-lens <name>`). For a problem, only the lenses of the layers it involves run.

## 2. One subagent per lens

Start one subagent per lens and give it only that lens's `brief`, so the lenses do not anchor on each other. Each one reads what its checklist needs (code, `stack.yaml`, the catalog, the history, CI) and answers with JSON only. Save each answer as `.agent-os/cache/audit/<lens>.json`.

## 3. Merge

```
agent-os audit merge .agent-os/cache/audit/*.json
```

The merge drops nothing silently:
- a finding with no evidence becomes a **question**;
- the same finding raised by several lenses is merged, and keeps every lens and all the evidence;
- severity (critical, high, medium, low) and confidence (confirmed, likely, to verify) stay separate;
- **strengths** are reported too.

## 4. The report and the artifact

Save the plan (`agent-os audit plan "<what>" --json > .agent-os/cache/audit-plan.json`), then:

```
agent-os audit report --plan .agent-os/cache/audit-plan.json .agent-os/cache/audit/*.json
```

It writes the audit artifact (`artifacts/<date>-audit-<slug>/`), which holds:
- the summary, the scores per lens and the findings with evidence;
- the questions, the strengths and a roadmap;
- the commit it audited.

When the same subject was audited before, the artifact also lists what was **fixed**, what is **new**, what got **worse** and what got better. Give the person the report in this order: findings by severity, then the questions, then the strengths, then the comparison. Do not add findings the lenses did not raise.

`agent-os audit verify <id>` later checks the audited commit and how far the branch has moved since.

## 5. Issues, lessons and the journal, only on the person's yes

Ask the person which findings to file. Nothing is filed without their confirmation.

```
agent-os audit propose <id> --accept <n> --accept <n>
```

It drafts one issue per accepted finding (one epic with sub-issues for more than five). Create each draft through /ticket, which searches for duplicates first. Capture the patterns worth remembering with `agent-os lessons add`. Then add a journal entry linking the artifact and the issues.

## 6. Learn

If the person rejects a finding as wrong, or a lens kept missing something the others found, capture why with `agent-os lessons add`.
