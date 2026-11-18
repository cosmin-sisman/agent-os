# Packs

Stack knowledge stays out of core. A **pack** is an optional bundle that a project adds when it uses that stack:
- rules (`.claude/rules/packs/<id>/`);
- subagents (`.claude/agents/`);
- gate suites and `gatePaths`;
- requirements (`requires.cli`, `requires.mcp`, `requires.env`);
- slot bindings.

```sh
agent-os pack list                     # what the package ships (* = added)
agent-os pack show stack-postgres
agent-os add stack-postgres [--dry-run]           # the same as agent-os pack add
agent-os pack remove stack-postgres [--dry-run]
```

## Add

The pack's rules (in the docs language) and subagents are installed as managed files, so `agent-os update` keeps them current.

Its configuration is added to `agent-os.json` **only where the team has not set it**. A gate suite with the same name, an existing CLI range or a bound slot stays as it is.

The lock records exactly which files and which settings the pack added. `agent-os env` then checks what it requires.

## Remove

Removal takes back only what the lock recorded for that pack: its files, and the settings it added (not the ones the team had before). Everything else stays.

If one of its files was edited by hand, nothing is removed. The command names the file and stops. To keep your version, `agent-os eject <file>` first; the pack is then removed and the ejected file stays.

## The reference pack: `stack-postgres`

- **A rule:**
  - every schema change is a migration, and migrations that ran are never edited;
  - migrations are reversible or say why not;
  - large tables change without locking writers;
  - every foreign key has an index, and hot queries are checked with `EXPLAIN`;
  - no `SELECT *`, and parameters are always bound;
  - row-level security is on for tables behind a public API;
  - transactions are short.
- **A `postgres-reviewer` subagent** that reviews migrations and SQL against that rule.
- **A `db-migrations` gate suite** (`npm run db:check --if-present`) for `**/migrations/**` and `**/*.sql`.
- **Requirements:** `psql >=14`, an optional project MCP server `postgres` (started with `$DATABASE_URL`, whose value is never read), and the `DATABASE_URL` variable.

## Format

`templates/packs/<id>/pack.yaml`:

```yaml
id: stack-postgres
name: "Postgres"
description: { en: "…", ro: "…" }
rules: [rules/postgres]                # rules/postgres.en.md and .ro.md, by the docs language
agents: [agents/postgres-reviewer.md]
gate: { db-migrations: "npm run db:check --if-present" }
gatePaths: { "**/migrations/**": [db-migrations] }
requires: { cli: { psql: ">=14" }, mcp: [ … ], env: [DATABASE_URL] }
slots: {}                              # e.g. { ui-design: some-skill }
```
