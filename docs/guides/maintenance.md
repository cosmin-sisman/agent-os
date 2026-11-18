# Keep a finished product healthy (maintenance)

For a product with releases and few recent commits: safe upkeep and an easy takeover.

## 1. Install

```bash
agent-os init --profile maintenance --lang en --solo --yes
agent-os init --me --chat en --yes
```

## 2. Runbooks and the takeover dossier

```bash
agent-os runbook
```

It writes `docs/runbooks/deploy.md`, `rollback.md`, `restore.md` and `takeover.md` from the branches, the release flow, the CI workflows and the stack. Fill in what the repository cannot tell (marked "to fill"). Existing runbooks are kept.

## 3. The upkeep audit

```bash
agent-os security watch
agent-os audit upkeep
```

`security watch` sends only package names and versions to the advisory databases. `audit upkeep` reads the result, the scanner reports and the lockfiles, and proposes prioritized issues: one per vulnerable package, secrets, licenses. It files nothing: `/runbook` creates the ones you confirm with `/ticket`.

## 4. Rehearse and release

```bash
agent-os security exercise vulnerable-dependency
agent-os release plan
```

The exercise walks an incident against your runbooks and proposes an issue for the gaps. `release plan` lists what would ship and what blocks it, such as a known-exploited dependency or a stale threat model.
