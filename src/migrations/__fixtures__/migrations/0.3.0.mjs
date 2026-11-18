// Fixture migration: adds the schema reference to agent-os.json, and records the order it ran in.
export const description = 'add $schema to agent-os.json'
export function migrate(project) {
  const team = project.readJson('agent-os.json') ?? {}
  if (!team.$schema) project.writeJson('agent-os.json', { $schema: 'https://example.com/agent-os.schema.json', ...team })
  const order = project.readText('.order') ?? ''
  if (!order.split('\n').includes('0.3.0')) project.writeText('.order', `${order}0.3.0\n`)
}
