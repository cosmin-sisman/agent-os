# Collaboration

How several people, each with their own agent sessions on their own laptops, work in one repository without stepping on each other. Design §5.

## Seeing overlap: `agent-os overlap`

```bash
agent-os overlap                       # the files changed on this branch
agent-os overlap --path src/db/        # specific paths; a folder ends with /
agent-os overlap --offline             # pushed branches only, no platform calls
```

It lists every open change request, and every pushed branch without one, that touches the same files as yours, with the author and the issues involved:

```
2 other change(s) touch your files; talk to them before you both go further:
  #40 feat(db): connection pool by @dan (#12): src/db/pool.ts
  branch fix/57-timeouts by Ana (#57): src/db/client.ts
```

- **Change requests**: the platform's list of open change requests, then the files of each one. Your own is left out.
- **Pushed branches** with no change request are compared locally with `origin/<integration>`, so run `git fetch` first. Long-lived branches are skipped.
- **The cache** (`.agent-os/cache/overlap.json`, never committed) keeps the files of each change request by its head commit, which never changes. The list itself is cached for 10 minutes. A repeated run with 30 open change requests asks for nothing.
- **It never blocks.**
  - `agent-os start` checks the paths the issue mentions, before you touch anything.
  - `agent-os pr preflight` checks the files the branch changes.
  - Both name the overlapping work so you can talk to its author (in the issue or the change request) and say so in your description.
