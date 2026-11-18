# Maintenance: /runbook and the upkeep audit

For a finished product (the `maintenance` profile, design §11): safe upkeep and an easy takeover.

## Runbooks

`agent-os runbook [--force] [--dry-run]` writes four files in `docs/runbooks/`, in the docs language:

| File | From |
|---|---|
| `deploy.md` | `branches` (integration, production, merge method, required checks), the release flow (`release plan`, `open`, `finish`), the CI workflows, the hosting and monitoring layers |
| `rollback.md` | the previous tag, the CI, the data layer, the incident journal entry, a hotfix branch |
| `restore.md` | the data and storage layers; restore into staging, check, then move the traffic; test it every quarter |
| `takeover.md` | how it ships, what runs (`stack.yaml`), the owners (CODEOWNERS), the decision records, the access to hand over |

Facts the repository cannot tell are marked `_to fill: …_`. A runbook that exists is kept unless `--force`. `agent-os security exercise` walks incidents against these files (§23).

## Upkeep audit

`agent-os audit upkeep [--report <file>…]` is read-only: it calls no platform and writes nothing. It proposes:

| Proposal | Priority | From |
|---|---|---|
| one per vulnerable package, whatever the number of its advisories | p0 when known exploited or critical, p1 when high, p2 otherwise | the last advisory watch (`.agent-os/cache/security.json`); accepted risks are left out |
| one per secret in a scanner report | p0 | `security.reports` and `--report` (SARIF, gitleaks); the value is never copied |
| one per tracked `.env` file (not `.example`) | p0 | `git ls-files` |
| copyleft licenses of shipped packages | p1 | `package-lock.json`; dual licenses with `OR` and dev-only packages pass |
| undeclared licenses | p3 | `package-lock.json` |

It exits 1 when a p0 or p1 is proposed. The `/runbook` skill files the proposals the person confirms through /ticket.
