{{! area: docs }}
# Postgres (stack-postgres pack)

- **Every schema change is a migration**, committed with the code that needs it. Never edit a migration that has run anywhere; add a new one.
- **Migrations are reversible or say why not.** Destructive steps (dropping a column or table, narrowing a type) go in their own migration, after the code stops using what they remove.
- **Large tables change without locking writers:** create indexes `CONCURRENTLY`; add a column as nullable or with a constant default, backfill in batches, then add the constraint.
- **Every foreign key has an index**, and every query on a hot path is checked with `EXPLAIN` before it ships.
- **No `SELECT *` in application code**; name the columns. Parameters are always bound, never concatenated into SQL.
- **Row-level security** is on for every table reachable through a public API (Supabase, PostgREST). A policy change gets a test for who can and cannot read.
- Transactions are short: no network calls or user waits inside one.
