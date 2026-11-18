# /discover

`/discover` is for a repository that already has history (the `active` profile, design §11). It infers the conventions the team follows, so the rules reflect them instead of overriding them.

```
agent-os discover plan [--commits <n>]
agent-os discover apply --accept <id>… [--dry-run]
```

`plan` reads the last commits on the first-parent history (500 by default), the change requests and the remote branches. It saves its proposals in `.agent-os/cache/discover.json` and writes nothing else. Every proposal cites its evidence. A proposal without evidence is not made.

| Proposal | From | Writes on accept |
|---|---|---|
| `commit-types` | the share of `type(scope): summary` subjects and the types in use | `conventions.types`: the defaults plus the types in use they lack, never fewer. When every type in use is already allowed, it is only a note. |
| `commit-style` | fewer than 60% conventional subjects | a note: start in adoption mode, or exempt the old style |
| `issue-refs` | `[#N]` or `(#N)` at the end of subjects | a note |
| `branch-prefixes` | the head branches of change requests and the remote branches (`feature/`, `bugfix/`…) | `branches.prefixes`, by issue type, when it differs from the defaults; `agent-os start` names branches with it |
| `merge-method` | merge commits against squashed commits ending with `(#N)` | `branches.mergeMethod` |
| `area-map` | tracked files per top-level folder and the commit scopes | `.agent-os/cache/discover-area-map.md`, a table for AGENTS.md |
| `decision:<N>` | a merged change request whose description states a decision ("we decided", "instead of", "agreed to"…) | a `decision` journal entry quoting it, with `#N` in its refs |

`apply` writes only the accepted ids. Config keys are validated before `agent-os.json` is written.

The `/discover` skill describes each area with its own subagent, in parallel, and reviews every proposal with the person before `apply`.
