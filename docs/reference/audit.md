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

An audit creates nothing on the platform. Issues for accepted findings are proposed with /ticket, only on the person's yes.

```
agent-os audit plan "the orders queries are slow since the last migration" --json
agent-os audit merge .agent-os/cache/audit/*.json
```
