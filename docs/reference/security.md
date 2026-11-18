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
