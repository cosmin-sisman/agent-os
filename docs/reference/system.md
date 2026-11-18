# The system map: `system.yaml` and `agent-os system`

The stack map says *what* a project is built with. `system.yaml` says *how it is put together*: its components, where they live, what they expose and what they consume. Design §24. It is one readable file, committed and reviewed. `agent-os system detect` drafts it, and people correct it.

## The format

```yaml
components:
  web:
    kind: app                  # app | service | worker | package | external
    path: apps/web             # in this repository, or repo: owner/name for another one
    layer: internal-frontend   # a layer from stack.yaml
    exposure: public           # public | internal | private
    consumes: [api]            # other components
    owners: [ana]
  api:
    kind: service
    path: apps/api
    provides:
      - http: { spec: apps/api/openapi.yaml, base: /api/v1 }   # http | graphql | grpc | events | webhook | queue | db
    consumes: [db]
  stripe:
    kind: external
```

## Commands

```sh
agent-os system detect [--write]   # the repository's shape and a draft; --write creates system.yaml when there is none
agent-os system check              # validate system.yaml (exit 1 on problems)
agent-os system show               # components and edges
```

**detect** reads workspaces and never runs anything:
- pnpm (`pnpm-workspace.yaml`), npm or yarn (`package.json` `workspaces`), Turborepo on top of them;
- Nx (`project.json` and `implicitDependencies`);
- Go workspaces (`go.work` and `go.mod` requires);
- Cargo (`[workspace] members` and path dependencies);
- Maven (`<modules>` and dependencies by `artifactId`).

How the draft is built:
- Each workspace package becomes a component, and its dependencies on other members become `consumes` edges. A repository without workspaces gets one component for its root package.
- **Every component cites its evidence** (the manifest and the workspace file). It goes in a comment in the draft.
- **Kinds** come from the folder (`apps/`, `services/`, `workers/`, `packages/`…). A server framework with no UI in an app folder makes a service.
- **Exposure** is read from platform files in the component's folder (`vercel.json`, `wrangler.toml`, `netlify.toml`, `fly.toml` → public). Where nothing says, detect asks instead of guessing: the question is listed, and left as a comment in the draft.
- **Layers** come from stack.yaml paths.

**check** reports:
- unknown keys, kinds, exposures and interfaces, with the closest match;
- `consumes` that name no component, or the component itself;
- components without a `path` or `repo` (external ones need neither);
- a bad `repo`;
- layers that stack.yaml doesn't have (warning).

## Contract diffs in change requests

```sh
agent-os system contracts [--base <branch>]   # the contract changes on this branch (exit 1 when one is breaking)
```

For each spec that system.yaml names (`provides: - http: { spec: … }`) and the diff touches, the version on the base branch is compared with the branch's. OpenAPI (JSON or YAML), AsyncAPI and GraphQL SDL are reduced to their surface:
- operations and their parameters;
- request and response fields, with local `$ref`s resolved;
- channels and payload fields;
- types, fields and arguments.

Breaking:
- **anything removed**: an operation, a parameter, a field (a removed field is always breaking), a channel, a type;
- **an input made stricter**: an optional parameter or field that becomes required, a new required input on something that existed. A renamed endpoint is a removal plus an addition, so it is breaking.

Additions are listed but are not breaking.

`agent-os pr create` runs the same comparison. A breaking change:
- labels the change request `contract:breaking` (ro `contract:incompatibil`);
- requests reviews from the owners of every consumer (components whose `consumes` names the provider), people and teams. GitLab has no group reviewers, so groups are reported to mention instead.

A consumer in another repository (`repo: owner/name`, pinned with `ref:`) that lists no owners here has them read from that repository's system.yaml at the pinned ref, through the platform.

## Affected components: a gate for monorepos

```json
"gateAffected": { "command": "pnpm --filter ./{path} test" }
```

With `gateAffected.command`, the gate tests only what a change can break:
1. The components that contain a changed file (the longest component path wins).
2. Every component that depends on one of them, transitively.

Each one gets a suite named `affected:<id>`, with `{id}`, `{path}` and `{name}` filled in. The command runs through a shell and these values come from the repository, so each must be a plain id or path (letters, digits and `. _ @ / -`, no `..` segment, no leading `-`). Anything else stops the gate with exit 2, naming the component, before any suite runs. Its reason in the results is "changed" or "depends on <component>". `--all` runs every component. The static `gate` and `gatePaths` suites run as before, next to these.

The graph is system.yaml's components and `consumes` edges when the file exists, else the workspaces `system detect` reads. It depends only on the files and the diff, and the set is sorted, so the laptop and CI compute the same affected set. In CI, `gate --from-ci` takes the base from the change request event.

`agent-os overlap` (and `pr preflight`) also name the components two changes share, a finer unit than layers.

## Endpoint inventory

```sh
agent-os system endpoints [--undocumented] [--json]
```

Every route the code declares, next to every operation the specs document. Source files are read **as text** by framework-specific patterns; nothing is imported or run:
- Express, Hono, Fastify, Koa;
- NestJS (`@Controller` and `@Get`…);
- Next.js (`app/**/route.ts`, `pages/api/**`) and Astro endpoints;
- FastAPI, Django (`urls.py`);
- Rails (`config/routes.rb`, `resources`);
- Spring (`@RequestMapping` and `@GetMapping`…);
- ASP.NET (minimal APIs and `[Http…]` attributes);
- Go routers (chi, gin, echo, `HandleFunc`).

For each route the inventory gives:
- method, path, component (from system.yaml or the workspaces), file and line;
- `auth`: **marked** when an authentication marker is visible (middleware such as `requireAuth`, `Depends(get_current_user)`, `@PreAuthorize`, `[Authorize]`, `@UseGuards`…), otherwise **unknown**. Unknown is never "none", since auth may live elsewhere;
- **documented** or not, by comparing with the OpenAPI specs that system.yaml names or that the repository holds. Paths are normalized across styles (`:id`, `{id}`, `<int:id>`, `[id]`).

Spec operations no code declares are listed too. **Frameworks the project uses that agent-os cannot read yet** (Remix, SvelteKit, Nuxt, Laravel, Phoenix, tRPC procedures, GraphQL servers…) are reported, not silently skipped. Test files are left out. The inventory is written to `.agent-os/cache/endpoints.json`, rendered on demand and never committed.

## System checks

```sh
agent-os system checks     # exit 1 when a check fails
```

They read system.yaml, the endpoint inventory and source files as text, and never run anything. Each finding names the component, the file (with the line where there is one) and the fix.

| Check | Level | What |
|---|---|---|
| `spec-drift` | warn | a route of a component with a spec that the spec doesn't document; a spec operation no code declares |
| `public-auth` | warn | a route on a `public` component with no visible authentication marker (health and well-known paths excepted) |
| `exposure` | fail | an `internal` or `private` component whose folder has a public platform file (`vercel.json`, `wrangler.toml`, `fly.toml`, …) |
| `webhook-signature` | fail | an incoming webhook route whose file shows no signature verification (`constructEvent`, svix, HMAC with `timingSafeEqual`, …), or a `webhook` with `signed: false` |
| `cycles` | fail / warn | components that depend on each other in a cycle (fail); JS/TS modules that import each other statically (warn; lazy `import()` is not a cycle) |
| `deep-imports` | warn | a module reaching into another component's files by relative path, or importing `pkg/src/…` instead of the package |
| `shared-db` | warn | services or workers that use the same `db` component without depending on each other |
| `timeouts` | warn | outgoing calls (`fetch`, axios, got, ky, requests, httpx) in a service or worker without a timeout or signal |

`doctor` runs them once the project has system.yaml (the `system` check). `pr preflight` (the security pass) warns about findings in the files the change touches.

## API docs and the system map in the artifact site

`agent-os artifact site` (and the opt-in Pages workflow) adds a **System** section to the index, once the project has system.yaml:
- **A system map** (`system-map/`): an inline SVG with one column per kind, boxes colored by exposure and arrows for `consumes`, followed by the component table.
- **An API reference per spec** that system.yaml names (`api/<component>/`). For OpenAPI it shows each operation with its parameters, request and response fields (local `$ref`s resolved); for AsyncAPI, channels with payload fields.

The pages are generated by agent-os, not by Swagger UI or Redoc, which load from CDNs. Like every artifact they are **self-contained**, with no scripts, styles or fonts from anywhere else. **Spec text is only ever escaped:** titles, summaries, descriptions and names appear as text, Markdown is not rendered, and no link is built from spec content, so a `<script>` or a `javascript:` link in a description stays inert. The pages are rebuilt on every site build, and the Pages workflow also runs when system.yaml or a spec changes.

**A missing spec, drafted from the code:**

```sh
agent-os system spec api [--write-to apps/api/openapi.json]
```

This drafts an OpenAPI skeleton from the routes the endpoint inventory finds for that component: paths with their parameters and a TODO summary citing the file and line. It never replaces an existing file.
