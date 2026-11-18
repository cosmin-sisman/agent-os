---
type: note
refs: ["#87"]
areas: [artifacts]
author: cosmin-sisman
---

# Doctor checks artifacts: self-contained pages, refs, size, staleness

doctor checks artifacts: metadata, refs, a page size budget (artifacts.maxPageKb), external loads, staleness. A page that loads anything from outside fails with the URLs named; this covers script, style, image, frame and media sources, srcset, CSS url() and @import, fetch, XHR and WebSocket targets. Plain links are navigation and stay allowed, as do data: URIs and relative paths. Unknown refs, oversized pages and stale sources are warnings, so a living artifact waiting for its rebuild does not fail the loop.
