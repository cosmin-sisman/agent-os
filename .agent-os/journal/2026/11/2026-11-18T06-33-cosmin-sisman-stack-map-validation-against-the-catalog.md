---
type: note
refs: ["#74"]
areas: [stack]
author: cosmin-sisman
---

# Stack map: validation against the catalog, show summary, new from a blueprint

`stack.yaml` is validated against the catalog: unknown keys and ids name the closest match through the shared did-you-mean helper. `stack show` renders the layers as a table and summarises the layers in use: distinct languages and providers, average complexity, AI-friendliness and provider cost, the steepest learning curve. With `compliance.euOnly`, it flags providers whose EU regions are `verify` or unknown, on every layer not rejected, since an evaluated provider needs the same decision. `stack new --from <blueprint>` writes the file and checks it validates; a test makes every catalog blueprint produce a valid stack.
