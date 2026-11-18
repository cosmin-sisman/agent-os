---
type: decision
refs: ["#108"]
areas: [security]
author: cosmin-sisman
---

# Advisory watch: only names and versions leave, one network module, KEV gates the release

The advisory watch matches OSV.dev (which includes the GitHub and GitLab advisories) and CISA KEV against the packages in the lockfiles. Only package names, ecosystems and versions leave the project, and --dry-run shows exactly those requests without sending any. All network access sits in one module, the one named exception in the no-network test. It runs in a child Node process so the project's CA and proxy apply. The watch is off by default on self-managed hosts and can use an internal mirror. The digest ranks known-exploited advisories first, then severity, then shipped direct dependencies, and keeps one Security digest issue current. The release gate and SessionStart read the cached result, never the network. A scheduled job is a template for projects only, off unless asked for. With sbom shipped, no command is left planned, so the tests that need one now add their own for their process.
