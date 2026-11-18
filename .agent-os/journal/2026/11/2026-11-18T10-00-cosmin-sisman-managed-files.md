---
type: decision
refs: ["#6", "#68"]
areas: [cli]
author: cosmin-sisman
---

# Managed files: lock, merge bases, three-way merge

Decisions:
- The merge base is stored, not reconstructed: `.agent-os/base/<key>` keeps exactly what agent-os last installed, and the lock records its sha256. A three-way merge needs the base, and reconstructing it would mean fetching old package versions, which offline and air-gapped teams cannot do. Because the lock's hashes are those of the bases, `update --relock` can always rebuild a broken lock.
- "Unmodified" means equal to the base, never "equal to what we last wrote". Otherwise a merged file containing local edits would be overwritten on the next update.
- On a conflict, nothing in the project changes: the proposal goes to `<path>.rej`, the base stays, and the next update tries again. There are no half-applied merges.
- In settings.json, ownership is decided per hook entry (the command runs `agent-os hook`), and the managed set is hashed in a canonical form, independent of event order, so a teammate's reordering is not an edit. An existing agent-os entry written by hand counts as unmanaged and goes to `.rej` instead of being overwritten.
- `update` today only supports `--relock`; the full flow is #68.
