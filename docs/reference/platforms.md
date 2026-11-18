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
