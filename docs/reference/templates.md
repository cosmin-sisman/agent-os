# Templates

Everything agent-os installs (skills, rules, issue forms, the PR or MR template, CI files) is rendered from templates, so one package fits every repository, pack set and language. The engine (`src/templates/engine.mjs`) has no dependencies, and its output depends only on the template and the configuration.

## Syntax

| Tag | Does |
|---|---|
| `{{ path.to.value }}` | inserts the value, escaped for the output: as is in Markdown, a valid literal in `.json` and `.yaml` |
| `{{{ path }}}` | inserts the value as is, in any format |
| `{{#if expr}} … {{else}} … {{/if}}` | `expr` is `path`, `!path`, `path == "text"` or `path != "text"`; a missing path is false |
| `{{#each list as item}} … {{/each}}` | loops; inside it, `{{@index}}`, `{{@first}}`, `{{@last}}`, and `{{this}}` when there is no `as` |
| `{{! comment }}` | removed from the output |

A block tag or comment alone on its line removes that whole line, so templates can be indented and spaced for reading without leaving blank lines in the output.

An unknown placeholder, an unclosed block or a misplaced `{{else}}` fails the render with `file:line:column`. Nothing is guessed.

## Values

| Name | Holds |
|---|---|
| any configuration key | the merged configuration with defaults (`branches.integration`, `platform.type`, `packs`, …), see [configuration](configuration.md) |
| `pack.<id>` | `true` when the pack is installed |
| `lang.<area>` | the language of an area (`en` or `ro`) |
| `labels.<group>.<name>` | a core label's name in the `labels` language: `labels.type.bug` is `type:bug` or `tip:bug` |

## Language variants

A file that differs by language comes as `name.en.ext` and `name.ro.ext`. Both declare their area on the first line:

```
{{! area: issues }}
name: Bug
…
```

The variant in that area's language is rendered to `name.ext`. With `issues: ro` and `prs: en`, the issue forms come out in Romanian and the PR template in English. A file without variants renders once. A missing variant, an undeclared or unknown area, or a plain file next to its variants is an error.
