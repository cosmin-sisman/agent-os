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

## Recommendations: `stack propose` and `stack compare`

```sh
agent-os stack propose --level 2 [--family typescript|polyglot]   # the blueprints for a product's level
agent-os stack compare drizzle-supabase-postgres prisma-neon-postgres
```

Every recommendation cites the catalog scores it rests on:
- **propose** lists the blueprints for the level, or the nearest level when there is none. Each comes with its description and takeaway, plus its computed scores: layers, average complexity, AI-friendliness and provider cost, languages, steepest learning curve. They are ordered by AI-friendliness, then simplicity.
- **compare** shows two technologies side by side (complexity, AI-friendliness, language and learning curve, provider and cost, EU regions) and says which scores separate them.

The `/kickoff` skill uses `propose` for a greenfield product, then `stack new --from`, layer by layer. The `/stack` skill explains, compares and changes the stack.

**Read the docs first.** Layers agents know poorly (aiFriendly 2 or less) get a rule telling agents to read the official documentation before writing code. When the layer's language has a rule template (TypeScript, JavaScript, Python, SQL, YAML), it is a line in that rule. Otherwise it goes in `.claude/rules/stack/read-the-docs.md`, scoped to the layer's paths.

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

## Areas from the stack

Every layer in use (status `chosen`) is an **area**:
- **Labels:** `agent-os setup` creates `area:<layer>` (in ro, `zona:<layer>`; `area::<layer>` where labels are scoped) for each layer in use. The color follows the layer's group, and the description comes from the catalog. Adding a layer to stack.yaml and running setup adds its label. Existing labels keep their color and description.
- **Change requests:** `agent-os pr create` labels the change request with the areas of the layers its changed files fall under (the layer `paths`), next to the issue's type and area labels.
- **Lessons:** recall before a change matches cards by the areas of the changed files, as well as by path and text.
- **Overlap:** overlapping changes show the areas the shared files belong to.
- **CODEOWNERS:** layers that list `owners` (logins or teams) and `paths` produce a managed block in the project's CODEOWNERS (`.github/`, `.gitlab/`, `docs/` or the root, whichever exists). The team's own lines around the block are never touched, and a block edited by hand gets a `.rej` instead of being overwritten.

## Detect and drift

```sh
agent-os stack detect [--write]   # what the code shows, each with its evidence; --write drafts stack.yaml when there is none
agent-os stack drift              # where stack.yaml and the code disagree (exit 1); doctor runs it as warnings
```

**detect** reads manifests and config files; it never runs anything:
- `package.json` dependencies and Python requirements (`requirements*.txt`, `pyproject.toml`);
- framework configs (`next.config.*`, `astro.config.*`, `svelte.config.*`, …), `schema.prisma`, `drizzle.config.*`, Supabase migrations;
- `Dockerfile` and compose files, `turbo.json`, workflows (`.github/workflows/`, `.gitlab-ci.yml`), `eas.json`, `*.tf`;
- provider files: `vercel.json`, `wrangler.toml`, `fly.toml`, `railway.json`, `netlify.toml`.

Each detection names its catalog technology, its layer, the **evidence** (file and packages) and the paths it covers. Dependencies, build output and test fixtures are skipped. `--write` drafts stack.yaml with the evidence in each layer's note. It never overwrites an existing file.

**drift** reports three kinds of disagreement:
- **mismatch:** a layer whose technology the code doesn't show while it shows another one in that layer ("stack.yaml says drizzle-supabase-postgres for data-layer, but the code uses Prisma + Neon Postgres: packages/db/package.json (@prisma/client)"). The fix is `stack set`.
- **unlisted:** a technology the code shows in a layer stack.yaml doesn't list.
- **empty-path:** a layer path that matches no file.

The `doctor` `stack` check reports the same findings as warnings, since the code may be mid-migration.

**Layers elsewhere:**
- `gateLayers` attaches gate suites to layers (`"data-layer": ["migrations"]`), so a change under a layer's paths runs them, next to `gatePaths`.
- The doctor `area-map` check warns when a layer in use isn't mentioned in the AGENTS.md area map.

## Import from a stack builder sheet

```sh
agent-os stack import plan.xlsx [--sheet Builder] [--write [--force]] [--overlay]
agent-os stack import plan.csv  --write
```

**Reading the sheet:**
- It finds the header row, in en or ro: Layer/Strat, Technology/Tehnologie, the chosen or recommended Provider/Furnizor, Status, Notes/Note.
- It reads the rows below it, and the project name and level labelled above the table.
- Names map to catalog ids whatever their case or diacritics ("Email / Notificări" → `email-notifications`).
- Statuses map from en or ro: Ales → chosen, De evaluat → evaluating, Opțional → optional, Respins → rejected.
- Without `--write`, the stack.yaml it would write is printed. With `--write`, it writes it, and refuses to replace one without `--force`.

**Unknown technologies and layers** become **overlay suggestions**. With `--overlay`, they are added to `.agent-os/catalog/` (never replacing an id) for you to complete. Until then, `stack check` reports their ids as unknown.

**xlsx files come from outside, so they are read defensively,** with `node:zlib` and no dependency:
- limits on the number of entries, each entry's and the total unpacked size, and the compression ratio (zip bombs);
- an entry named with `..` or an absolute path is refused;
- only cell values are read: a formula gives its cached value and is never evaluated, and macros and external links are ignored.

CSV can use commas or semicolons, with quoted fields.

`render` comes with a later issue.
