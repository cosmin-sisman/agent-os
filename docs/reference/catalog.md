# The stack catalog

`catalog/*.yaml` lists what a `stack.yaml` can name. Each file is a list of entries with a unique `id`:

| File | Entries | Fields beyond id and name |
|---|---|---|
| `layers.yaml` | the layers of a system | `group`, `name` and `description` (localized) |
| `technologies.yaml` | what fills a layer | `layer`, `language`, `provider` (ids), `runtime`, `complexity` and `aiFriendly` (1 to 5), `note` (localized) |
| `languages.yaml` | programming languages | `kind`, `performance`, `learningCurve`, `aiFriendly` (1 to 5), `strength` and `typicalUse` (localized) |
| `providers.yaml` | where things run | `kind`, `ease`, `cost` (1 to 5), `euRegions` (`yes`, `global`, `verify`, `n/a`), `mcpHint`, `role` (localized) |
| `runtimes.yaml` | OS and runtimes | `kind`, `when` (localized) |
| `blueprints.yaml` | reference stacks | `level`, `family`, `name`, `description`, `takeaway` (localized), `layers`: rows of `layer` plus `tech` or `language`/`provider`/`runtime`, and `detail` |

## Rules (checked by `agent-os stack catalog check`, in CI)

- **Ids:** lowercase, made of letters, digits, `.`, `+` and `-`, and unique within a file. Never rename one: projects reference it. Deprecate it through `src/lifecycle/lifecycle.yaml` instead.
- **References resolve:**
  - a technology's `layer`, `language` and `provider`;
  - a blueprint row's `layer`, `tech`, `language` and `provider`.

  `language: none` is allowed for things with no code of their own.
- **Localized texts** are maps with both `en` and `ro`. The `ro` text is ASCII only: no diacritics and no other non-ASCII characters (write `-` for a dash).
- **Problems name the file and the id**, for example `catalog/technologies.yaml: astro: provider "vercell" is not in providers.yaml`.
- **Scores are relative and indicative.** Explain an unusual one in the `note`.
- Mark `euRegions: verify` when you couldn't confirm the provider's EU regions. With `compliance.euOnly`, `stack show` flags it.

## Project overlays

A project adds or adjusts entries in `.agent-os/catalog/<file>.yaml`, the same format, committed with the project:
- **New id:** the entry is added, for example an in-house framework or a private provider.
- **Existing id:** the fields the overlay sets replace those fields; the rest stay. For example, `- id: resend` with `euRegions: "yes"` once the team has confirmed it.

Every `stack` command reads the merged catalog. `stack catalog check` validates the overlays with the same rules, and references may point across files and overlays. `stack catalog` lists the counts and the overlays in use.
