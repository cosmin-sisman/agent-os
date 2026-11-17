# Security policy

agent-os runs commands, writes files and installs hooks in other people's repositories, so we take security reports seriously.

## Reporting a vulnerability

Please **do not open a public issue.** Use [GitHub private vulnerability reporting](https://github.com/cosmin-sisman/agent-os/security/advisories/new). Include the version, what an attacker can do, and the steps to reproduce.

We aim to acknowledge reports within 3 working days and to agree on a fix and disclosure timeline within 10.

## Supported versions

Before 1.0, only the latest minor release receives fixes. After 1.0, the latest major release does, and the previous major gets security fixes for six months.

## Scope

In scope: the CLI, the hooks, the skills and rules it installs, the generated GitHub workflows, and anything that could leak a project's code, secrets or private data, including through `/upstream`.
