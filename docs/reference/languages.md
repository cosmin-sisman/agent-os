# Languages

Each area of text agent-os and its agents produce has its own language: `en`, or `ro` (Romanian **without diacritics**). Areas mix freely: issues in `ro` with PRs in `en` is a normal setup. Decision: [language per area](../decisions/2026-11-18-language-per-area.md).

| Area | Covers | File |
|---|---|---|
| `chat` | how the agent talks to you | personal (`.agent-os/local.json`) |
| `issues` | issue titles, bodies, comments the agent starts | team (`agent-os.json`) |
| `prs` | pull or merge request titles, descriptions, comments | team |
| `commits` | commit messages | team |
| `branches` | branch slugs (always lowercase ASCII) | team |
| `labels` | label names and descriptions | team |
| `milestones` | milestone titles and descriptions | team |
| `releases` | release notes | team |
| `codeComments` | comments and headers in code | team |
| `docs` | documentation in `docs/` | team |
| `journal` | journal entries, decision records | team |

Code identifiers, file names, routes and database names are always English. A reply to an existing comment uses that comment's language.

## Commands

```bash
agent-os lang                                # every area and its language
agent-os config set languages.issues ro      # change one area (chat goes to your personal file)
agent-os lang check body.md --area issues    # diacritics in a ro area: file:line:col and the ASCII letter; exit 1
agent-os lang check --text "Titlu: plată"    # check a string
agent-os lang rule                           # the language rule installed for agents
```

## Why ASCII Romanian

Diacritics break branch names, label searches and some terminals, and they get typed inconsistently: comma-below `ș` and cedilla `ş` look alike but compare as different text. In `ro` areas agent-os writes plain `a i s t`. `lang check` finds every form, including upper case, the cedilla variants and decomposed characters. Other non-ASCII text, such as emoji or letters from other languages, is not reported.

## Core labels and milestones

Core labels (type, priority, size and flags such as `needs-decision` or `contract:breaking`) and milestone names come from dictionaries keyed by stable ids ([`src/i18n/labels.yaml`](../../src/i18n/labels.yaml), [`src/i18n/milestones.yaml`](../../src/i18n/milestones.yaml)). With `labels: ro`, `type:bug` is created as `tip:bug`. Because the id is stable, switching the language later renames the label in place and keeps it on its issues (platform setup, #11 and #93). On platforms with exclusive labels, the first `:` becomes `::` (`prioritate::p0`). Area labels come from the stack map.
