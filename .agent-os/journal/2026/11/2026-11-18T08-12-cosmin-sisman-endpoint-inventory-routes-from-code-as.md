---
type: note
refs: ["#114"]
areas: [system]
author: cosmin-sisman
---

# Endpoint inventory: routes from code as text, compared with the specs

The endpoint inventory reads routes from code as text, with patterns for Express/Hono/Fastify/Koa, NestJS, Next, Astro, FastAPI, Django, Rails, Spring, ASP.NET and Go routers; nothing from the project is imported or run. Each route is compared with the OpenAPI specs, so undocumented routes and spec operations without code both show. Auth is "marked" only when a marker is visible and otherwise "unknown", never "none", because authentication often lives in middleware the text pattern cannot see. Frameworks in use without an extractor are reported. The result is rendered into the cache, never committed.
