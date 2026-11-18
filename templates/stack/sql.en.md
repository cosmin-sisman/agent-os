{{! area: docs }}
# SQL

Applies to {{paths}}.

- Every schema change is a migration, with its way back (a down migration or a written rollback).
- Parameterized queries only; never build SQL from user input.
- Destructive statements (DROP, TRUNCATE, DELETE without WHERE) need a backup plan in the change request; /release asks before shipping them.
- Row-level security or an explicit access check on every table that holds user data.
{{#if lowAi}}
## Read the docs first

Agents know {{lowAi}} poorly: read its official documentation for the version in use before writing code, and cite it in the change request.
{{/if}}
