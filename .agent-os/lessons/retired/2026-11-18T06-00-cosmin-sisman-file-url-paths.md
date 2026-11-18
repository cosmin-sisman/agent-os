---
areas: [cli, standards]
paths: ["src/**", "scripts/**", "bin/**"]
keywords: ["import.meta.url", "fileURLToPath", windows, paths]
source: "#63 (PR #132), test file path built from URL.pathname"
confidence: high
upstream: "#101"
promotedTo: "docs/rules.md: Paths"
retired: 2026-11-18
retiredBecause: "promoted to docs/rules.md: Paths"
---

Build file paths from `import.meta.url` with `fileURLToPath(new URL(…, import.meta.url))`, never with `.pathname`: `.pathname` keeps a leading slash before Windows drive letters and URL-encodes spaces, so the path breaks on Windows and in folders with spaces. Proposed for the core standards rule (#101).
