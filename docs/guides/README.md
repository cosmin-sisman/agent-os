# Guides

Start from the state your repository is in. `agent-os init --detect` reads it and suggests a profile; it writes nothing.

```bash
npx agent-os init --detect
```

| Your repository | Profile | Guide |
|---|---|---|
| empty, or a few commits and no code | `greenfield` | [Start a new product](greenfield.md) |
| specifications or docs, little code | `spec-first` | [From specifications to issues](spec-first.md) |
| recent commits and open pull or merge requests | `active` | [Adopt agent-os in a live repository](active.md) |
| tags and releases, few recent commits | `maintenance` | [Keep a finished product healthy](maintenance.md) |

Every guide ends in the same daily loop: `/next`, `/start`, the work, `/pr`, `/ship`, and `/release` from time to time (see [the loop](../reference/loop.md)).

## Reference

- [Commands](../reference/commands.md): every command, its usage and options, generated from the CLI.
- [Configuration](../reference/configuration.md): every key in `agent-os.json` and `.agent-os/local.json`.
- [Languages](../reference/languages.md): the language of each area (chat, issues, pull or merge requests, commits, docs…), `en` or `ro`.
- [Skill catalog](../reference/skill-catalog.md): every core skill and when it is used.
- [FAQ](faq.md).
