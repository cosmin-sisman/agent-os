# Migrations

One file per version that changes something in projects: `migrations/<version>.mjs`. `agent-os update` runs the ones after the project's pinned version, up to the new one, in version order.

```js
// migrations/0.5.0.mjs: what this migration changes, in one line.
export const description = 'rename machine.workers to machine.maxWorkers'

/** @param {ReturnType<import('../src/migrations/runner.mjs').projectApi>} project */
export function migrate(project) {
  const local = project.readJson('.agent-os/local.json')
  if (!local?.machine?.workers) return // already migrated, or nothing to do
  local.machine.maxWorkers ??= local.machine.workers
  delete local.machine.workers
  project.writeJson('.agent-os/local.json', local)
}
```

Rules:
- **Idempotent.** Running it a second time changes nothing: check before changing. A test runs every migration twice against the fixtures in `__fixtures__/<version>/`.
- **Only through `project`** (`readJson`, `writeJson`, `readText`, `writeText`, `exists`, `note`), so dry runs and change reports work.
- **Paired with the lifecycle.** A `removed` item in `src/lifecycle/lifecycle.yaml` names the migration version that handles it.
