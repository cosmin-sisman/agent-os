// Fixture migration: fails on purpose when a marker file exists, to test that a failure stops the chain.
export const description = 'may fail'
export function migrate(project) {
  if (project.exists('.fail-0.9.0')) throw new Error('the marker asked me to fail')
  const order = project.readText('.order') ?? ''
  if (!order.split('\n').includes('0.9.0')) project.writeText('.order', `${order}0.9.0\n`)
}
