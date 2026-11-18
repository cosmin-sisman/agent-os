---
type: note
refs: ["#46"]
areas: [testing]
author: cosmin-sisman
---

# Test gaps: configurable mapping, gate input and a Stop reminder

Test gaps are configurable: `testing.map` pairs source globs with test path templates (`{dir}`, `{name}`, `{ext}`) for stacks whose tests don't follow the built-in names, and `testing.exclude` takes globs as well as prefixes. The same list feeds the gate (a warning in its result) and a Stop reminder. The Stop handler only ever warns, returns no decision, stays silent when `stop_hook_active` is set, and names a set of gaps once per session, so it cannot loop. It is part of the hooks block agent-os installs into projects; nothing is enabled in this repository's settings.
