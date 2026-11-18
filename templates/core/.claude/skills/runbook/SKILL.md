---
name: runbook
description: Keep a finished product safe to maintain and easy to take over - write the deploy, rollback and restore runbooks and the takeover dossier from the release flow, and run the upkeep audit (vulnerable dependencies, secrets, licenses) whose prioritized issues are filed only on confirmation. Use for a project in maintenance, before a handover, or when someone asks how to deploy, roll back or restore.
---

# /runbook: upkeep and takeover

## 1. The runbooks

```
agent-os runbook
```

It writes `docs/runbooks/deploy.md`, `rollback.md`, `restore.md` and `takeover.md` from the branches, the merge method, the release flow, the CI workflows, the stack's data and hosting layers, the owners and the latest tags. Runbooks that already exist are kept; `--force` replaces them, after the person agrees. Fill in each "to fill" with the person: backup location, consoles, access to hand over.

## 2. The upkeep audit

```
agent-os audit upkeep
```

Read-only. It proposes one issue per vulnerable package (p0 if known exploited or critical, p1 if high), one per secret found in a scanner report or a tracked `.env` file (p0, the value never shown), and license reviews (copyleft or undeclared). It reads the last advisory watch; when there is none, run `agent-os security watch` first.

## 3. File what the person confirms

Go through the proposals with the person. Create the confirmed ones with /ticket (duplicate search first), keeping the proposed priority unless the person changes it. Nothing is filed without a yes.

## 4. Rehearse

Walk one exercise against the new runbooks: `agent-os security exercise vulnerable-dependency`. Gaps become proposed issues the same way.

## 5. Learn

If a runbook step was wrong when it was used, capture why with `agent-os lessons add`, and fix the runbook in the same {{vocab.changeRequest}}.
