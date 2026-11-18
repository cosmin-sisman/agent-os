---
name: discover
description: Infer the conventions an active repository already follows (commit style, branch prefixes, merge strategy, areas) and the decisions made in its pull or merge requests, each with its evidence, then apply only what the person accepts. Use when agent-os is adopted in a repository with history, or when someone asks what this repository's conventions are.
---

# /discover: rules that reflect the repository

## 1. The plan

```
agent-os discover plan
```

It reads the recent history, the pull requests and the branches, and proposes:
- the commit types;
- the branch prefixes (`branches.prefixes`);
- the merge method;
- an area map draft;
- one decision entry per pull request whose description states a decision.

Every proposal comes with its evidence (counts and examples); one without evidence is never proposed. Nothing is written yet.

## 2. Describe each area, in parallel

For the `area-map` proposal, start one subagent per area row. Each one reads only its folder: the entry points, what the code does, what an agent cannot infer. It answers with one line for the "What" column. Keep each line short.

## 3. Review with the person

Go through the proposals one by one and show the rule with its evidence. A rule the person rejects stays out. The history wins over the defaults: a proposal reflects what the team does, it never narrows it.

## 4. Apply what was accepted

```
agent-os discover apply --accept <id> --accept <id>
```

Accepted config proposals go into `agent-os.json`, accepted decisions into the journal, and the area map draft into `.agent-os/cache/discover-area-map.md`. Place that draft into AGENTS.md (with the subagents' lines) in a pull request, together with the configuration change.

## 5. Learn

If the person corrected an inferred rule, capture why with `agent-os lessons add`: the inference missed something.
