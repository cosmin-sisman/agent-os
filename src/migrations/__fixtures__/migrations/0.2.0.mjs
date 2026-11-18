// Fixture migration: renames machine.workers to machine.maxWorkers in the personal file.
export const description = 'rename machine.workers to machine.maxWorkers'
export function migrate(project) {
  const local = project.readJson('.agent-os/local.json')
  if (!local?.machine || !('workers' in local.machine)) return
  local.machine.maxWorkers ??= local.machine.workers
  delete local.machine.workers
  project.writeJson('.agent-os/local.json', local)
}
