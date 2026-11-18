# Adopt agent-os in a live repository (active)

For a repository with recent commits and open change requests. agent-os adapts to the team's conventions, not the other way around.

## 1. Install, keeping history as it is

```bash
agent-os init --detect
agent-os init --profile active --methodology forward-only --lang en --team --yes
agent-os init --me --chat en --yes
```

`forward-only` applies the conventions from today on. `retrofit` brings the history into the system instead (step 3). Hooks start in adoption mode: they only warn for the first 14 days.

## 2. Discover the team's conventions

```bash
agent-os discover plan
agent-os discover apply --accept branch-prefixes --accept merge-method
```

`plan` reads the history and the change requests. It proposes the commit types, the branch prefixes (`feature/`, `bugfix/`), the merge method, an AGENTS.md area map and the decisions found in change-request descriptions. Each proposal comes with its evidence. `apply` writes only the ids you accept. `/discover` also describes each area of the map with its own subagent.

## 3. Optional: bring history in

```bash
agent-os retrofit plan
agent-os retrofit apply
```

The plan file covers labels to map, milestones from tags, links between merged change requests and issues, and a baseline journal. Review it before `apply`. Closed change requests are never rewritten.

## 4. Check

```bash
agent-os doctor
agent-os overlap
```

`overlap` lists the open changes that touch the same files as yours.
