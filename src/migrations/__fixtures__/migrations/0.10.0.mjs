// Fixture migration: proves versions sort numerically (0.10.0 runs after 0.9.0 and 0.3.0).
export const description = 'mark 0.10.0'
export function migrate(project) {
  const order = project.readText('.order') ?? ''
  if (!order.split('\n').includes('0.10.0')) project.writeText('.order', `${order}0.10.0\n`)
}
