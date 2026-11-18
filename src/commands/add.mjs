// `agent-os add <pack>`: the short form of `agent-os pack add <pack>`.

import { run as pack } from './pack.mjs'

export const usage = 'agent-os add <pack> [--dry-run]'
export const options = {}

/** @param {import('../cli/context.mjs').Context} ctx */
export const run = (ctx) => pack(ctx, 'add', ctx.positionals[0])
