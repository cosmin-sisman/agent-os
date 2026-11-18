# Start a new product (greenfield)

For an empty repository. You end with `agent-os.json`, the rules and skills, a product doc, `stack.yaml`, a milestone and the first issues. A test runs these commands in this order, so they stay current.

## 1. Install agent-os into the repository

```bash
git init -b development
agent-os init --profile greenfield --platform github --project <owner/name> --lang en --solo --yes
```

Use `--platform gitlab` (and `--host <url>` for a self-managed GitLab) on GitLab. Use `--team` instead of `--solo` when change requests need an approval. Add `--setup` to also create the branches, protection, labels and milestone on the platform; it asks first unless you pass `--yes`.

Each person then sets their own chat language and limits, which are never committed:

```bash
agent-os init --me --chat en --yes
```

## 2. The product

In Claude Code, run `/kickoff`. It interviews you about the product, one question at a time, and writes `docs/product.md` with one `##` section per feature and its requirements as short list items.

## 3. The stack

`/kickoff` places the product on the complexity scale, then proposes the catalog's blueprints for that level with their scores:

```bash
agent-os stack propose --level <level>
agent-os stack new --from <blueprint> --project "<name>"
agent-os stack check
```

## 4. The first milestone and issues

```bash
agent-os ingest plan docs/product.md
agent-os ingest apply --milestone "MVP"
```

Each feature becomes an epic and each requirement a sub-issue that cites its section. When two statements disagree, `ingest` stops and asks first.

## 5. Check and start

```bash
agent-os doctor
agent-os next
```

`doctor` checks the setup and gives a readiness score. `/next` recommends the first issue, and `/start <n>` claims it.
