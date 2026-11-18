# The YAML agent-os reads

`stack.yaml`, `system.yaml`, the catalog, `artifact.yaml` and other agent-os files are YAML, so people can read and review them easily. agent-os has no dependencies, so it reads a strict **subset** of YAML with its own parser (`src/yaml/yaml.mjs`). The subset covers everything those files need. Anything outside it is refused with the file, line and column, never guessed.

## What you can write

```yaml
# Comments start a line or follow a space.
project: "Example B2B SaaS"     # double quotes: JSON escapes (\n, ă, \")
owner: 'it''s fine'             # single quotes: double the quote to escape it
level: 3                        # integers and floats are numbers
version: 1.7.12                 # anything that is not a number stays a string
enabled: true                   # true / false
note: ~                         # null, ~ or nothing at all

layers:                         # nested blocks: indent with spaces (any consistent amount)
  data-layer:
    tech: drizzle-supabase-postgres
    paths: ["packages/db/**", "supabase/migrations/**"]   # inline list, on one line
  storage: { tech: supabase-storage, status: chosen }     # inline map, on one line

steps:                          # a list of maps
  - name: build
    run: npm run build
  - name: test
owners:                         # a list may also sit directly under its key
- alice
- bob
```

## What is refused

| Construct | Example | Message |
|---|---|---|
| tabs in indentation | `<tab>key: 1` | tabs are not allowed for indentation; use spaces |
| anchors and aliases | `&base`, `*base` | anchors (&) / aliases (*) are not supported |
| tags | `!str 1` | tags (!) are not supported |
| several documents | `---`, `...` | multiple documents are not supported |
| block scalars | `\|`, `>` | block scalars are not supported; use a quoted string with \n |
| merge keys | `<<: *base` | merge keys (<<) are not supported |
| duplicate keys | `a: 1` twice | duplicate key "a" |
| multi-line inline lists or maps | `[1,` then `2]` on the next line | unclosed "[" (inline lists must fit on one line) |

Booleans are only `true` and `false`. `yes`, `no`, `on` and `off` are plain strings, as in YAML 1.2.

## Writing YAML from code

`stringify(value)` writes block YAML that `parse` reads back to an equal value. Strings are quoted only when they have to be.
