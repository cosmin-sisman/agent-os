// Capability slots: core skills never name another skill; they call a slot, and agent-os.json binds each slot to a
// skill (or to nothing, explicitly). Swapping a design or review skill is a one-line change. Design §6.

/** Every slot core uses, with its default binding: Claude Code built-ins where they exist, otherwise none. */
export const SLOT_DEFAULTS = {
  review: 'code-review',
  'security-review': 'security-review',
  standards: null,
  testing: null,
  'ui-design': null,
  ci: null,
  docs: null,
}
export const SLOTS = Object.keys(SLOT_DEFAULTS)

/** The built-in skills the defaults bind; they are registered with origin builtin so doctor and the index know them. */
export const BUILTIN_SKILLS = { 'code-review': { provides: ['review'], description: 'Claude Code built-in code review.' }, 'security-review': { provides: ['security-review'], description: 'Claude Code built-in security review.' } }

/** The effective bindings: the project's, over the defaults. */
export const slotsFor = (config) => ({ ...SLOT_DEFAULTS, ...(config.slots ?? {}) })

/** Paths that are user interface, for the ui-design slot. */
export const UI_FILE = /\.(css|scss|sass|less|html|vue|svelte|jsx|tsx|astro)$|(^|\/)(components?|ui|styles|pages|views)\//i
