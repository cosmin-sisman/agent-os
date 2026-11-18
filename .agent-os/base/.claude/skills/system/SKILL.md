---
name: system
description: Draft and keep up the system map (system.yaml) - components, where they live, what they expose and consume - from the repository's workspaces and manifests, asking where the code cannot tell. Use when someone asks how the project is put together, adds or splits a package or service, or before a security or architecture review.
argument-hint: "detect | check | show"
---

# /system: how the project is put together

## detect

```
agent-os system detect            # the shape (single app or monorepo) and a draft, each component with its evidence
agent-os system detect --write    # creates system.yaml when there is none
```

1. Read the draft with the person. Every component lists the files it was read from. Fix kinds and names that look wrong.
2. **Ask the questions detect lists**, one at a time: whether each app or service is public, internal or private. Never guess exposure. Write the answers into system.yaml.
3. Add what the code cannot show: `external` components (payment providers, other teams' services), `provides` (specifications, base paths, webhooks), `owners`, and `repo: owner/name` for components in other repositories.
4. `agent-os system check` must pass. Commit system.yaml with the change that needed it.

## check and show

```
agent-os system check
agent-os system show
```

Keep system.yaml in step with the code: a new workspace package, a removed service or a changed exposure belongs in the same pull request.

## Learn

When detect misread the repository (a component it missed, a wrong kind or edge), capture it with `agent-os lessons add` so the rules can improve (`/upstream` if it is about agent-os itself).
