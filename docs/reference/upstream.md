# Upstream: improving agent-os from a project

`/upstream` turns a gap a project finds in agent-os into an issue on the public repository, without leaking anything private. Design §18, decision [upstream feedback](../decisions/2026-11-18-upstream-feedback.md).

```bash
agent-os upstream draft --title "…" --what "…" [--proposal "…"] [--where "/pr"] [--key gatePaths] [--kind bug]
agent-os upstream draft --lesson <id>            # from a lesson card
agent-os upstream draft … --file --approve       # send it, after the person read the exact text
```

**The draft** follows the upstream *Improvement* form and contains only:
- the agent-os version and the profile;
- the skill or command involved;
- configuration key names (never their values);
- OS and Node;
- the description, filtered.

**The filter removes:**
- code blocks, and inline code that is not an agent-os command, configuration key or skill;
- file paths, both absolute and repository-relative (but `.claude/` and `.agent-os/` ones);
- links (but the agent-os repository's), email addresses and @mentions;
- token-like secrets;
- the project's own name, owner, folder and host.

The output says how many of each it removed.

**Duplicates:** it searches upstream with the filtered title's words only, never local text. A similar issue is shown with the advice to react or comment there, and filing is refused unless `--new`.

**Approval:** nothing is sent without `--file --approve`. The URL is then recorded in the journal and, for a lesson, on its card as `upstream:`.

**Opt-out:** with `upstream.enabled: false` the draft is saved under `.agent-os/cache/upstream/` and nothing leaves the project.
