---
name: artifact
description: Make an artifact (a self-contained page in artifacts/ - analysis, comparison, discovery, release report, retro, architecture, dashboard, stack map), build and verify it, and link it to the issues and {{vocab.changeRequests}} it belongs to. Use when a result reads better as a page than as Markdown, or when someone asks to share, check or link one.
argument-hint: "new <type> <slug> | build <id> | verify | link <id> <#N|!N>"
---

# /artifact: pages that are versioned, verified and linked

## new

```
agent-os artifact new <type> <slug> [--title "<title>"] [--ref "#N"]
```

1. Fill in the page (`index.html`) and the one-sentence `summary` in `artifact.yaml`. The page is self-contained: inline CSS and JS, data embedded, nothing loaded from outside (doctor fails otherwise).
2. A page made from data gets a `template.html` with a `__DATA__` placeholder, and its sources in `artifact.yaml`. Then run `agent-os artifact build <id>`.
3. Set `status: current` when it is ready. A snapshot is frozen once merged; a new date makes a new artifact.

## verify

```
agent-os artifact verify [<id>]
```

A stale artifact had a source change since it was built. Rebuild a living one with `agent-os artifact build <id>`; a snapshot stays as it was.

## link

```
agent-os artifact link <id> {{vocab.issueRef}}<n>
agent-os artifact link <id> {{vocab.crRef}}<n>
```

This adds one comment: the title, the summary, the **repository copy first** (the source of truth), then the published site when `artifacts.siteUrl` is set. It is written in the language of the thread (ro without diacritics), and the ref goes into the artifact's `refs`. In the {{vocab.changeRequest}}, list the artifact under `## Artifacts`.

## publish

Mirroring a page to an external host (such as claude.ai) is not part of agent-os yet: those links are personal, and the repository copy stays the source of truth. Share the repository link, or the Pages site (`artifacts.pages: true`).

## Learn

A page that went stale unnoticed, or that loaded something from outside, is a lesson: `agent-os lessons add`.
