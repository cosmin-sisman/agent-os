---
type: decision
refs: ["#111"]
areas: [security]
author: cosmin-sisman
---

# Vulnerabilities are reported privately; no path files one as a public issue

`agent-os security report` sends a vulnerability to the platform's private channel, through the adapter's `reportVulnerability`: a draft security advisory on GitHub, a confidential issue on GitLab. It never falls back to a public issue: a missing right is an error. `issue new` and `issue create` refuse text that reads as an exploitable weakness, and hardening goes through `--hardening` with the security label. Public advisories about dependencies are not refused. The KEV release gate from #108 completes the rule. This repository's private vulnerability reporting was already on, and no setting was changed.
