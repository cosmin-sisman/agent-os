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

Endpoint inventory (#114), system checks (#115) and the system map artifact (#118) build on this file.
