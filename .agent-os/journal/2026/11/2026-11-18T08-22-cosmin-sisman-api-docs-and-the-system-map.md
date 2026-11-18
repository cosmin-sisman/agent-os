---
type: note
refs: ["#118"]
areas: [system]
author: cosmin-sisman
---

# API docs and the system map in the artifact site, self-contained and escaped

The artifact site now carries the system: a system map drawn as inline SVG, and an API reference per spec named in system.yaml. agent-os generates the pages itself instead of using Swagger UI or Redoc, because those load from CDNs and artifacts must be self-contained. Spec text is treated as untrusted: it is only escaped, Markdown is not rendered and no links are built from it, so markup or javascript: links in a spec stay inert. `system spec <component>` drafts an OpenAPI skeleton from the routes in the code, citing file and line, for components without one.
