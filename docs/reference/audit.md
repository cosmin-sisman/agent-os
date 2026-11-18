# /audit

`/audit` reviews something through separate lenses and merges what they find into one report. The CLI does the deterministic half: it detects the subject, picks the lenses, writes each lens's brief and merges the answers. The skill runs each lens in its own subagent.

## Subjects

| Subject | Detected from | Lenses (preset) |
|---|---|---|
| idea | a description of something to build | product, architecture, stack, performance-cost |
| spec | a folder with documents and no code | product, architecture, security-privacy, delivery |
| project | a folder with code (`.`) | all nine |
| release | `release` or a version | security-privacy, delivery, operations, code-quality |
| problem | a symptom ("login fails…") or an issue `#N` | the lenses of the layers it involves |
| system | a question across several layers | architecture, security-privacy, performance-cost, operations |

The detected subject is confirmed with the person. `--as <subject>` overrides it, and `--lens` and `--no-lens` add or remove lenses.

For a problem, the layers come from catalog layer names and common words (queries and migrations point to the data layer, login to auth). Each layer group has its own lenses: a data-layer problem runs architecture, security-privacy, performance-cost and operations, and nothing else.

## Lenses

product, architecture, stack, code-quality, security-privacy, performance-cost, delivery, process, operations. Each lens has a question and a checklist, and both go into its brief.

## Findings

A lens answers with `{"lens", "findings": [...], "strengths": [...]}`. Each finding has:
- `title`;
- `evidence`: a `path:line`, a command and its output, `#N`, a catalog score or a quote;
- `severity`: critical, high, medium or low;
- `confidence`: confirmed, likely or to verify;
- one `recommendation` and its `alternatives`.

`agent-os audit merge <answers>` follows these rules:
- A finding without evidence becomes a question. The lens can also ask a question directly with `{"question": …}`.
- The same finding from several lenses is merged by title or shared evidence. It keeps every lens and all the evidence, with the highest severity and confidence.
- Findings are sorted by severity, then by confidence.
- A finding with no recommendation is noted.
- Strengths are kept.

## Outputs

`agent-os audit report --plan <plan.json> <answers…>` writes the **audit artifact**, `artifacts/<date>-audit-<slug>/` (type `audit`). It holds:
- the summary;
- a score per lens: 100, minus 40, 20, 10 or 5 for each critical, high, medium or low finding the lens raised;
- the findings table, the questions and the strengths;
- a roadmap: critical and high findings now, medium next, low later;
- the commit it audited.

`data.json` also keeps the report under `audit`, so the next audit can compare with it. `agent-os audit verify <id>` checks that the audited commit is in the repository and counts the commits since then.

**Comparison.** When an earlier audit artifact has the same subject and input, the new one lists the findings that were **fixed** (gone), **new**, **worse** (higher severity) and **better**. Findings match by title or by shared evidence.

**Proposed issues.** `agent-os audit propose <id>` proposes nothing until the person picks findings with `--accept <n>…`. It then drafts one issue per finding:
- a title by lens;
- labels: `type:bug` for security and privacy findings, `type:chore` for the rest, a priority from the severity, and `area:audit`;
- a body with the evidence, the recommendation and its alternatives.

More than five accepted findings become one epic with sub-issues. The drafts are filed through /ticket. Neither `report` nor `propose` calls the platform.

**Lessons and the journal.** The /audit skill captures the patterns worth remembering with `agent-os lessons add`. It then adds a journal entry linking the artifact and the issues.

```
agent-os audit plan "the orders queries are slow since the last migration" --json
agent-os audit merge .agent-os/cache/audit/*.json
agent-os audit report --plan .agent-os/cache/audit-plan.json .agent-os/cache/audit/*.json
agent-os audit propose 2026-11-18-audit-project --accept 1 --accept 3
agent-os audit verify 2026-11-18-audit-project
```
