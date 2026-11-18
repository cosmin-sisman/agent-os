# Security: the advisory watch

Only advisories that touch the project matter. Design §23.1.

```sh
agent-os security watch [--issue] [--dry-run]   # exit 1 while a known-exploited advisory is open
agent-os sbom [--out sbom.json]                 # CycloneDX, from the lockfiles
```

## What is matched

The packages come from the lockfiles, read as text: `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, pinned `requirements*.txt`, `poetry.lock`/`uv.lock`, `Cargo.lock` (registry crates) and `go.sum`. Each package has its version, whether it is a direct dependency (declared in `package.json` or the requirements) and whether it is development-only.

The sources are:
- **OSV.dev**, which includes the GitHub and GitLab advisory databases;
- **CISA's Known Exploited Vulnerabilities** catalog.

## What leaves the project

**Only package names, ecosystems and versions.** No code, no paths, no repository or project name. `--dry-run` prints exactly the requests the watch would send, and sends none.

The requests are the one exception to "agent-os makes no network calls of its own". They live in a single module (`src/security/advisories.mjs`), named in the test that checks every other module stays off the network. They run in a child Node process that gets the project's private CA (`platform.caFile`) and proxy (`machine.proxy`), the same way the tools agent-os starts do.

**Self-managed and air-gapped:** on a self-managed host (`platform.host` set) the watch is **off by default** and says so. Turn it on with `security.advisories.enabled: true`. For an air-gapped install, point `security.advisories.osvUrl` and `kevUrl` at an internal mirror.

## Priority and the digest

Advisories are ranked like this:
1. **known exploited (KEV)** first;
2. then severity (critical, high, moderate, low);
3. then shipped direct dependencies, before transitive and development-only ones.

Each line names the packages and versions it touches and the version that fixes it.

`--issue` keeps **one** issue current, *Security digest*, labelled `security`: the same issue is edited every time, never duplicated. Risks the owners accepted in writing are listed apart:

```json
"security": { "acceptedRisks": [{ "id": "CVE-2026-0001", "reason": "the vulnerable path is not reachable", "by": "ana", "until": "2027-01-31" }] }
```

The result is also cached in `.agent-os/cache/security.json`, which these read without going to the network:
- **The release gate:** `agent-os release finish` refuses a known-exploited advisory in a shipped (not development-only) dependency, unless it is in `security.acceptedRisks`.
- **SessionStart** warns when the last watch found known-exploited or critical advisories.

## The scheduled job (projects only, opt-in)

With `"ci": { "securityWatch": "daily" }` (or `"weekly"`), install adds a workflow that runs `security watch --issue` on that schedule:
- **GitHub** (`.github/workflows/agent-os-security.yml`): `issues: write` on that job only.
- **GitLab** (`.gitlab/agent-os-security.yml`): it runs from a pipeline schedule on a protected branch. It writes the issue with `AGENT_OS_SECURITY_TOKEN`, a protected and masked variable. Without that token it reports and writes nothing.

Both pass `agent-os ci review`. By default (`off`), nothing is installed.

# Security: the pass on a change

```sh
agent-os security pass [--base <branch>] [--report <file>…]   # exit 1 on a FAIL
```

`/pr` (and `/mr`) runs it before the review. The `security-review` slot's skill, when bound, runs after it.

- **Layers.** The layers the diff touches come from stack.yaml paths. Without a stack they come from the file paths: workflows → CI; Dockerfiles, compose and Terraform → infrastructure; SQL and migrations → data; auth, login and session files → auth; routes, controllers and handlers → API; components → frontend. Each layer brings its OWASP ASVS checklist items. The ones no detection covered are listed to check by hand.
- **Detections in the changed files.** They read the files as text, and each one has the checklist item, the fix and the reason:

  | Layer | Detection |
  |---|---|
  | API | a webhook route without signature verification (FAIL); a new non-GET endpoint, or a public one without auth, with no rate limiting (`V11.1.4`) |
  | Data | SQL built from strings (`V5.3.4`) |
  | Frontend | raw HTML insertion (`V5.3.3`); a secret-looking public variable (`NEXT_PUBLIC_…SECRET`, `V14.1.1`) |
  | Auth | tokens accepted without verification (`algorithms: ['none']`, `verify: false`); cookies without HttpOnly or Secure |
  | Infrastructure | unpinned base images; images that run as root; `0.0.0.0/0` in Terraform |
  | CI | the errors of `agent-os ci review` |

- **Scanner results, read and never run.** agent-os does not install or run scanners. It reads the reports the project's tools produce: SARIF (CodeQL, Semgrep, GitLab SAST, Trivy, …) and gitleaks JSON. They come from `security.reports` or `--report`, and only findings on the changed files are kept. **A secret's value is never copied**, only its rule and location. When no report is read, the pass says so.
- **Missing scanners.** List the scanners the team runs in `security.scanners` (for example `["gitleaks", "osv-scanner"]`). `agent-os env` reports the ones the laptop lacks, by asking only for their version.

## Preparing: threat model, abuse cases, regression tests, exercises

**Threat model.** `agent-os security threat-model` writes the STRIDE threat model as a living artifact, `artifacts/<date>-threat-model/` (type `threat-model`). It holds:
- each layer of `stack.yaml` with its threats and their mitigations;
- the data flows between layer groups that cross a trust boundary;
- the layers it cannot model.

`stack.yaml` is one of the artifact's sources, so the model goes stale as soon as the stack changes. Four things react to that:
- `agent-os stack set` refreshes it in the same step;
- SessionStart says it is stale;
- `release plan` lists it as a problem until it is refreshed;
- `security threat-model` refreshes it in place: the same folder, new data, new hashes.

**Abuse cases.** `/test plan` adds "Given an attacker…" scenarios for the security-sensitive areas an issue touches: payments, auth, public API and personal data. It reads them from the `area:` labels, the title and the Goal or Context section, in the issues language.

**Regression tests.** A fixed vulnerability is a bug, and every bug's plan starts with its regression scenario, a test that fails without the fix. In a sensitive area, the abuse cases follow it.

**Exercises.** `agent-os security exercise [<name>]` walks a tabletop incident against the project's runbooks:
- `leaked-key`;
- `compromised-account`;
- `vulnerable-dependency`.

The runbooks are found in `docs/runbooks/`, `runbooks/`, `docs/operations/`, `docs/incidents/` and `RUNBOOK*.md`. Each step is reported as covered by a runbook or as a gap. Gaps are proposed as one issue, filed only on confirmation through /ticket, and exit 1. An exercise is a conversation: nothing is run, and scenarios only ever target environments the project owns.
