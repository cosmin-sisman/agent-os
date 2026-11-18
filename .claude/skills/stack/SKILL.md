---
name: stack
description: Explain, compare and change the project's stack map (stack.yaml) with the catalog's scores behind every recommendation - show it, compare two technologies, change a layer as a decision, detect or import it, keep it in step with the code. Use when someone asks what the project is built with, whether to switch a technology, or which option fits a layer.
argument-hint: "show | compare <tech> <tech> | set <layer> <tech> | status <layer> <status> | drift"
---

# /stack: the stack map, with reasons

## Explain

```
agent-os stack show       # layers, languages, providers, averages, EU check
agent-os stack check
```

Explain the stack from the summary. Name the layers agents know poorly (AI-friendliness 2 or less): their rules say to read the docs first.

## Compare and recommend

```
agent-os stack compare <tech> <tech>
agent-os stack catalog                 # what the catalog has (plus .agent-os/catalog/ overlays)
```

**Every recommendation cites the catalog scores it rests on**: complexity, AI-friendliness, language and learning curve, provider cost, EU regions. Say which scores decide it for this project ("simpler: complexity 2 vs 3"), and what the catalog cannot know (the team's experience, existing contracts). Choose the way the standards ask: two or three candidates, compared, one picked with a reason.

## Change

```
agent-os stack set <layer> <tech> --why "<reason>"
agent-os stack status <layer> chosen|evaluating|optional|rejected --why "<reason>"
```

A change writes a proposed decision record with the comparison. Review it with the person and turn the proposed follow-up issues into tickets with /ticket.

## Keep it true

```
agent-os stack drift      # stack.yaml against the code, with evidence
agent-os stack detect     # what the code shows, for a project without stack.yaml
agent-os stack import <sheet.xlsx|.csv>
```

## Learn

A recommendation the team rejected for a reason the catalog missed is a lesson (`agent-os lessons add`). A wrong or missing catalog score is an `/upstream` proposal.
