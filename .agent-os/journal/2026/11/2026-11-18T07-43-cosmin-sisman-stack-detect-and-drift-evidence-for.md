---
type: note
refs: ["#77"]
areas: [stack]
author: cosmin-sisman
---

# Stack detect and drift: evidence for every detection, drift in doctor

stack.yaml is kept honest against the code. `stack detect` maps manifests, framework configs, migrations, Dockerfiles, workflows and provider files to catalog technologies; every detection cites its evidence file. It never runs anything, and it skips dependencies, build output and fixtures. `stack drift` reports three kinds of disagreement: a layer whose technology differs from what the code shows, technologies in layers the stack does not list, and paths that match nothing. Doctor runs the same comparison as warnings, since the code can be mid-migration. The two layer uses deferred from #75 are here too: gate suites per layer (gateLayers) and the area map naming each layer in use.
