---
name: kickoff
description: Start a new product from a reference stack - find its complexity level, propose the blueprints for it with the catalog scores behind each, write stack.yaml from the chosen one and walk through every layer with the person. Use for a greenfield project, or when someone asks what to build a new product with.
argument-hint: "[what the product does]"
---

# /kickoff: from an idea to stack.yaml

## 1. The level

Ask, one question at a time, what decides the complexity:
- who uses it (the public, staff, other systems);
- whether there are accounts, payments, real-time features or a mobile app;
- the data and its sensitivity;
- the team and the deadline.

Place the product on the catalog's scale, from 1 (a brochure site) to 5 (an enterprise or streaming platform), and say why in one sentence.

## 2. The blueprints

```
agent-os stack propose --level <n> [--family typescript|polyglot]
```

Present each proposal with its reasons, **citing the catalog scores**: layers, average complexity, AI-friendliness, provider cost, languages, steepest learning curve. Add what the scores cannot capture, such as the team's languages and hosting constraints (`compliance.euOnly`). Recommend one and say why. The person chooses.

## 3. stack.yaml

```
agent-os stack new --from <blueprint> --project "<name>"
```

Walk through each layer with the person: keep it chosen, mark it optional or evaluating, or change its technology (`agent-os stack compare`, then `agent-os stack set <layer> <tech> --why …`). Fill in each layer's `paths` once the folders exist. Finish with `agent-os stack check` and `agent-os stack show`.

## 4. Next

Run `agent-os env propose` for the MCP servers and CLIs the providers suggest. Then turn the first layers into issues with /ticket.

## Learn

If the level or the blueprint turned out wrong once work started, capture why with `agent-os lessons add`.
