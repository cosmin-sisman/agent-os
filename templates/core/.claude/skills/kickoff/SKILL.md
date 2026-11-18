---
name: kickoff
description: Start a new product - interview the person about the product, write the product doc, find the complexity level and the stack from the catalog's blueprints, then create the first milestone and issues from the doc. Use for a greenfield project, or when someone asks what to build a new product with.
argument-hint: "[what the product does]"
---

# /kickoff: from an idea to a plan, a stack and the first issues

## 1. The product

Interview the person, one question at a time:
- the problem and who has it;
- what the first useful version does: its main flows, what is out of scope;
- what success looks like.

Write `docs/product.md` in the docs language with a `## ` section per feature of the first version. Under each section, list what it must do as short items ("- People can …", "- … must …"). Those items become the first issues, so each one is one piece of work. The person reviews the doc before anything else.

## 2. The level

Ask, one question at a time, what decides the complexity:
- who uses it (the public, staff, other systems);
- whether there are accounts, payments, real-time features or a mobile app;
- the data and its sensitivity;
- the team and the deadline.

Place the product on the catalog's scale, from 1 (a brochure site) to 5 (an enterprise or streaming platform), and say why in one sentence.

## 3. The blueprints

```
agent-os stack propose --level <n> [--family typescript|polyglot]
```

Present each proposal with its reasons, **citing the catalog scores**: layers, average complexity, AI-friendliness, provider cost, languages, steepest learning curve. Add what the scores cannot capture, such as the team's languages and hosting constraints (`compliance.euOnly`). Recommend one and say why. The person chooses.

## 4. stack.yaml

```
agent-os stack new --from <blueprint> --project "<name>"
```

Walk through each layer with the person: keep it chosen, mark it optional or evaluating, or change its technology (`agent-os stack compare`, then `agent-os stack set <layer> <tech> --why …`). Fill in each layer's `paths` once the folders exist. Finish with `agent-os stack check` and `agent-os stack show`.

## 5. Milestone and first issues

```
agent-os ingest plan docs/product.md
agent-os ingest apply --milestone "MVP"
```

Each feature section becomes an epic, and each item a sub-issue that cites its section. The milestone is created when it is missing. Add the setup work for the first layers with /ticket. Complete each issue the way /ticket does (area labels, priority, `agent-os test plan <n>`).

## 6. Next

Run `agent-os env propose` for the MCP servers and CLIs the providers suggest.

## Learn

If the level or the blueprint turned out wrong once work started, capture why with `agent-os lessons add`.
