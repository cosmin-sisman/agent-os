# The system map: components, interfaces and exposure

Status: accepted

## Context
Projects come as single apps, monorepos or many repositories of microservices. Components talk over HTTP, GraphQL, gRPC, events and webhooks, some are public and some must stay internal. Contracts (OpenAPI, AsyncAPI, GraphQL schemas) drift from the code, and breaking changes reach consumers unannounced.

## Decision
- One committed, readable `system.yaml` lists components (kind, path or repository, layer, exposure, provides, consumes, owners). `/system detect` drafts it from workspaces, manifests, routes and platform configuration.
- `/system` maps edges, inventories endpoints on demand (never committed), and checks spec drift, unauthenticated public endpoints, exposed internal components, unsigned webhooks, module cycles and deep imports.
- Change requests get contract diffs: breaking changes are labelled `contract:breaking` and consumer owners (including other repositories) are requested as reviewers.
- Monorepos use the dependency graph so the gate runs on affected packages only. Polyrepos fetch contracts from pinned refs.
- API docs (Swagger UI or Redoc) and a system map diagram are published as artifacts.

## Consequences
Architecture knowledge becomes explicit and checked continuously. Consumers learn about breaking changes before merge, and the security and audit skills gain a precise view of what is exposed.
