# The stack map: `stack.yaml` and `agent-os stack`

`stack.yaml` sits at the repository root and records what the project is built with, layer by layer. Every id in it comes from the catalog (`catalog/*.yaml`, plus the project's overlays in `.agent-os/catalog/`; see [the catalog](catalog.md)). [`examples/stack.yaml`](../../examples/stack.yaml) shows the format.

## The format

| Key | What |
|---|---|
| `project` | the project name |
| `level` | 1 (simple) to 5 (complex) |
| `blueprint` | the reference stack it started from (`catalog/blueprints.yaml`) |
| `compliance.euOnly` | `true` makes `show` flag providers whose EU regions must be verified |
| `layers.<layer>` | a layer id from `catalog/layers.yaml`, with the keys below |

A layer has these keys:
- `tech`: from `technologies.yaml`;
- `provider`: from `providers.yaml`;
- `language`: from `languages.yaml`, or `none`;
- `runtime`;
- `status`: `chosen`, `evaluating`, `optional` or `rejected`. The default is `chosen`.
- `paths`: globs in this repository;
- `owners`;
- `note`.

The language and provider default to the technology's.

## Commands

```sh
agent-os stack check                  # validate against the catalog (exit 1 on problems)
agent-os stack show [--json]          # the table and the summary
agent-os stack new --from b2b-saas [--project <name>] [--force] [--dry-run]
```

- **check** reports unknown keys and ids with the closest match (`unknown technology "drizle-supabase-postgres" (did you mean "drizzle-supabase-postgres"?)`). It also reports a wrong `level` or `status` and lists that aren't lists. It warns when a technology belongs to a different layer, or a layer names no tech, language or provider.
- **show** prints every layer as a table and summarises the layers in use (`chosen`):
  - distinct languages and providers;
  - average complexity and AI-friendliness of the technologies;
  - average provider cost;
  - the language with the steepest learning curve.
- **EU check.** With `compliance.euOnly`, `show` flags every layer that isn't rejected whose provider's `euRegions` is `verify` or unknown, so you can confirm it before strict GDPR work.
- **new --from** writes `stack.yaml` from a blueprint, one layer per row. Interactively it asks whether each layer is chosen now (otherwise `optional`). It refuses to replace an existing file without `--force`. `--dry-run` prints the file.

## Changing a layer: decisions, not edits

```sh
agent-os stack set data-layer prisma-neon-postgres [--why "<reason>"] [--dry-run]
agent-os stack status payments rejected [--why "<reason>"]
```

Changing a layer is an architecture decision, so each change does three things:
- **Edits stack.yaml in place.** Only that key changes; comments and layout stay, in block (`data-layer:` with indented keys) or inline (`auth: { tech: …, status: … }`) form. A layer that isn't there yet is added.
- **Writes a decision record** in `docs/decisions/` (proposed, in the docs language). It holds the catalog comparison of the old and new choice: complexity, AI-friendliness, language and its learning curve, provider and its cost, EU regions. It also has the reason from `--why`, and the consequences (the code under the layer's paths, a provider change).
- **Proposes follow-up issues:**
  - a migration (with acceptance criteria and a test scenario);
  - adopting a newly chosen layer;
  - removing a rejected one;
  - the environment for a new provider.

  They are printed and in `--json`, never created. Create them with `/ticket` or `agent-os issue new`.

Unknown layers and technologies are refused with the closest match. Setting what is already there changes nothing.

`detect`, `drift`, `import` and `render` come with later issues.
