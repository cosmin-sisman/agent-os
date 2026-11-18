# Platforms

agent-os works with **GitHub** (github.com, GitHub Enterprise Server) and **GitLab** (gitlab.com, self-managed, Dedicated). The platform is part of the team configuration. Design: [§20](../design/overview.md), decision: [platforms](../decisions/2026-11-18-platforms-github-and-gitlab.md).

```json
"platform": { "type": "gitlab", "host": "https://git.company.internal", "project": "team/app", "caFile": "certs/company-ca.pem" }
```

`host` is left out for github.com and gitlab.com.

## Detecting it

```bash
agent-os platform detect            # from the "origin" remote: what it is, why, and how to log in
agent-os platform detect --write    # the same, then saves it to agent-os.json after you confirm
agent-os platform                   # what is configured, and whether gh / glab is logged in to it
```

- `github.com` and `gitlab.com` are recognized from the remote alone.
- Any other host is **probed** with two anonymous requests and no token: `https://<host>/api/v3/meta` (GitHub Enterprise Server) and `https://<host>/api/v4/version` (GitLab, which answers 401 without a token; the version is read after login).
- A host that answers like neither is **reported, never guessed**. Set it by hand with `agent-os config set platform.type …`.
- Remotes in https, ssh and scp form are understood, including GitLab subgroups and custom ports. Credentials inside a remote URL are dropped: only host and project are kept.

## Logging in

agent-os never stores a token. Log in with the platform's own CLI, and agent-os reads only whether you are logged in and which scopes the token has (`agent-os env`):

```bash
gh auth login --hostname github.com
glab auth login --hostname git.company.internal
```

With a private certificate authority, point Node at it (`NODE_EXTRA_CA_CERTS=certs/company-ca.pem`) and configure the same CA in `glab`.

## Capabilities

What a project can use depends on the platform, the tier and the version, so agent-os asks:

```bash
agent-os platform probe             # the capability map (cached for 24 hours in .agent-os/cache/platform.json)
agent-os platform probe --refresh   # ask the platform again
```

| Capability | Fallback when missing |
|---|---|
| `subItems`: parent and child issues | a "Parent: #N" line in the child and a checklist item in the parent |
| `dependencies`: blocked by / blocking | a "relates to" link, the `blocked` label and a "Blocked by #N" line |
| `exclusiveLabels`: scoped labels | the naming convention (`type:*`), checked by `doctor` |
| `multipleAssignees` | one assignee and @mentions in a comment |
| `board`: a planning board | milestones and labels only |
| `pages`: an artifact site | CI job artifacts linked from the change request |
| `branchRules`: rulesets or push rules | protected branches only |
| `linkedBranches` | "Closes #N" in the change request |

- **github.com** capabilities are known without asking. **GitHub Enterprise Server** is probed endpoint by endpoint.
- **GitLab** is probed through `glab api`. Premium is recognized from the group epics endpoint (or push rules), and the Premium-only capabilities are marked *inferred* from the tier. Free-tier features are probed directly.
- Each entry says whether it is *known*, *probed*, *inferred*, from *config* or *unknown*. Unknown counts as missing, so the fallback is used until the platform answers.

Commands and skills decide by capability (`has(caps, 'dependencies')`, `planBlockedBy(caps, …)` in `src/platform/capabilities.mjs`), never by the platform's name. A test fails the build when they do.

## Platform routes

The package keeps what every project gets in `templates/core/`, and what only one platform gets in `templates/platform/github/` and `templates/platform/gitlab/`. An install or update renders core plus the active route, so a GitLab project never receives a `.github/` folder and a GitHub project never receives `.gitlab/`. The lock records the platform. An update for a different platform is refused, because switching is its own step (#98).

| | GitHub | GitLab |
|---|---|---|
| change request | pull request, `#N`, skill `/pr` | merge request, `!N`, skill `/mr` (`/pr` is an alias that points to it) |
| issue templates | `.github/ISSUE_TEMPLATE/*.yml` (issue forms) | `.gitlab/issue_templates/*.md` (with a `/label` quick action) |
| change-request template | `.github/pull_request_template.md` | `.gitlab/merge_request_templates/Default.md` |

Templates use the platform vocabulary (`{{vocab.changeRequest}}`, `{{vocab.crRef}}`, `{{vocab.cli}}`, …) and path placeholders such as `.claude/skills/__crSkill__/`, so a core template never asks which platform it is on. A route may add files but never override a core file.

## Self-managed and on-premise

For company instances behind a private CA or a proxy, or without internet access. Nothing is written to the machine (no certificate store, npm or git configuration). agent-os passes the settings to the tools it starts (gh, glab, git, npx) through its own process environment, and a variable the laptop already sets always wins.

| Setting | Where | Becomes |
|---|---|---|
| `platform.caFile` | `agent-os.json` (team), path to a PEM bundle in the repository | `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` (gh, glab), `GIT_SSL_CAINFO` (git) |
| `machine.proxy`, `machine.noProxy` | `.agent-os/local.json` (personal) | `HTTPS_PROXY`/`HTTP_PROXY` (both cases), `NO_PROXY` |
| `npmRegistry` | `agent-os.json` | `npm_config_registry`, `--registry` for npx in hooks and CI jobs |
| `ci.image`, `ci.tags` | `agent-os.json` | the image and runner tags of the generated jobs (GitLab `image`/`tags`, GitHub `container`/`runs-on`) |

`agent-os env` fails when the CA file is missing, or when a proxy or registry URL holds credentials. The value is never shown. Keep credentials in `HTTPS_PROXY` or `~/.npmrc` on the laptop, and rotate any that were committed.

A Node process can only trust a CA through `NODE_EXTRA_CA_CERTS` if the variable is set when the process starts. For agent-os's own requests, set it in the shell profile too. The tools agent-os starts get it automatically.

### Installing without internet access

The catalog, templates, skills and rules ship inside the package, so nothing is fetched at runtime. Install agent-os one of two ways:

- **From a tarball** committed to the repository: `npm install -D ./vendor/agent-os-<version>.tgz`. The `file:` dev dependency makes hooks call `npx --no-install agent-os`, the project's own copy.
- **From an internal registry mirror**, with `npmRegistry` set. Hooks and the generated CI jobs call `npx -y --registry <mirror> @cosmin-sisman/agent-os@<version>`.

For an air-gapped runner, set `ci.image` to an image in the internal registry and `ci.tags` to the runner's tags. The gate, loop and retro jobs then run there and install from the mirror.

### Version gates

A self-managed instance can be older than the cloud. Capabilities that need a version are on only when the probe finds it:

| Capability | Needs | Otherwise |
|---|---|---|
| `ciComponents` | GitLab 17.0 | the generated job files, included locally |
| `idTokens` | GitLab 15.7 or GitHub Enterprise Server 3.5 | masked, protected CI variables |

An unknown version counts as too old, so `doctor` never fails on what the instance cannot do. `agent-os platform probe --refresh` probes again after an upgrade.

### Data stays in

On a self-managed host (`platform.host` set), `/upstream` is off by default: it shows the cleaned draft and saves it to a file, and nothing reaches the public repository. Set `upstream.enabled: true` to turn it on deliberately.

## Switching platform (plan)

`agent-os platform switch --to github|gitlab --project <owner/name> [--host <url>] [--map <file>] --plan` shows what moving the project to the other platform changes in the repository. It writes nothing but `.agent-os/cache/platform-switch.json`. The platform's importer moves the issues and change requests; agent-os only re-renders its own files.

| Part of the plan | What |
|---|---|
| remove | the old route's managed files, unchanged since agent-os wrote them (the lock's hashes) |
| conflicts | managed files edited by hand: kept, never deleted; port or eject them first |
| add | the new route's files (`.gitlab/…` or `.github/…`) |
| rewrite | core files whose text depends on the platform (pull request ↔ merge request, `/pr` ↔ `/mr`) |
| ci | on GitLab, `.gitlab-ci.yml` with an `include:` of each agent-os job file, when it is missing; otherwise the includes to add by hand |
| manual | the team's own files under the old route's folders (such as `.github/workflows/ci.yml`), to port by hand |
| config | `platform.type`, `platform.project`, `platform.host`, and `platform.board` dropped when leaving GitHub |
| journal | references in journal entries to re-link from the importer's map (`{"#12": "#7", "#40": "!3"}`), and the ones the map lacks |

It exits 1 while conflicts or the team's own files would leave something from the old route behind. Once they are handled, no file from the old route remains. Applying the plan (one branch, `chore/platform-switch-<to>`, and one change request on the new platform) is a later step.
