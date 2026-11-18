---
type: incident
refs: ["#265"]
areas: [platform, adoption]
author: cosmin-sisman
---

# discover plan failed: a 1 MB API page overflowed the spawn buffer

`discover plan` failed on this repository with exit 2 and an error of about 1 MB. Cause: `spawnSync` buffers 1 MB of output by default, and one page of 100 pull requests with their bodies came to 1,057,218 bytes. Node stopped gh with ENOBUFS and a null status. ghClient then took the first line of stdout (the whole JSON, on a single line) as the error message.

Fix, in two parts:
- gh, glab and git now run with a 256 MB output buffer (src/util/spawn.mjs). A process that is cut off or times out returns a short stderr ("gh's output was larger than 256 MB and was cut off", "did not answer in time") instead of a partial stdout.
- The GitHub and GitLab clients cap an error's text to 300 characters, plus the full length, so a person never reads a dump of a response.

After the fix, `discover plan --commits 50` on this repository reads 129 change requests and makes 17 proposals.
