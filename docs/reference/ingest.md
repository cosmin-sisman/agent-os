# /ingest-docs and /kickoff

`agent-os ingest` turns Markdown specifications into issues. `/ingest-docs` uses it in a spec-first repository. `/kickoff` uses it in a greenfield one, on the `docs/product.md` it writes with the person.

```
agent-os ingest plan [<file|folder>…]
agent-os ingest apply [--resolve <c1>=a|b|both…] [--milestone <m>] [--dry-run]
```

`plan` reads the given paths, or `docs/`, `specs/`, `spec/` and `requirements/`. Folders such as `decisions/` and the journal are left out. It saves the plan in `.agent-os/cache/ingest.json` and creates nothing:
- **Requirements** are the list items of a section and its sentences with "must", "shall", "should", "needs to" or "will". Text in code blocks and tables is left out.
- **Epics** are the top sections under a document's title that hold requirements. Each of their requirements becomes a sub-issue.
- **Sources.** Every epic and sub-issue records its file, line and heading path. Its body cites them with a link to the section's anchor, for example `docs/product.md#accounts`.
- **Contradictions** are pairs of statements about the same thing (most of their words in common) that disagree: different numbers ("30 minutes" against "15 minutes"), or one negated and the other not. `plan` lists them and exits 1.

`apply` creates nothing while a contradiction has no resolution. It exits 1 and lists the questions to ask the person. With `--resolve c1=a` (keep the first statement), `b` (keep the second) or `both` (no conflict), the overruled statement's sub-issue is not created. Epics get `type:epic`, sub-issues `type:feature` and their parent. A `--milestone` that does not exist is created.
