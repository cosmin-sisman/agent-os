---
type: decision
refs: ["#5"]
areas: [cli, i18n]
author: cosmin-sisman
---

# The template engine and language variants

`render(source, context, { file, format })` is a pure function. Placeholders are escaped for the output format, so a `.json` or `.yaml` template can never produce invalid JSON or YAML from a value with quotes or colons. Unknown placeholders fail with file:line:column, while missing paths in conditions are simply false, so `{{#if pack.x}}` works without declaring every pack.

Decision: a template with language variants declares its area on its first line (`{{! area: issues }}`) instead of in a separate manifest, so each file says what it is. Standalone block lines are decided on the original source, not on already-modified text. The first version decided on modified text and broke on consecutive block lines.
