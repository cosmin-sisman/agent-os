---
type: decision
refs: ["#63", "#64", "#71", "#72", "#81"]
areas: [stack, artifacts, updates, loop]
author: cosmin-sisman
---

# Stack map, artifacts, upstream feedback and safe updates join the design

The owner's stack builder spreadsheet became the first catalog: 24 layers, 126 technologies, 20 languages, 39 providers, 10 runtimes and 10 blueprints, written in readable YAML in English and ASCII Romanian (scripts/bootstrap). Layers become the backbone that drives labels, paths, the gate, the environment check and lessons (design §16).

Owner requirements recorded:
- stack and catalog as an easy-to-read file (YAML);
- artifacts that anyone with access can open, versioned, verifiable and indexed, and that can be mentioned in issues and PRs (§17; the first is the stack map, published through GitHub Pages);
- a skill that files improvements on this public repository from any project (`/upstream`, §18);
- safe updates with lifecycle markers: new, stable, deprecated, legacy, removed (§19);
- a presentation README with a logo.
