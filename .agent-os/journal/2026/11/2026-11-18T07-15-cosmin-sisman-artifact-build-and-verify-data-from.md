---
type: note
refs: ["#83"]
areas: [artifacts]
author: cosmin-sisman
---

# Artifact build and verify: data from sources, hashes, staleness

Artifacts are built and verified by the CLI. `artifact build` fills a template's __DATA__ placeholder with the parsed YAML and JSON sources (ASCII JSON that cannot close its script), adds the document skeleton to fragments, and records a sha256 per source, the template included, in artifact.yaml. `artifact verify` reports stale artifacts and exits 1 only with --strict. The repository's stack map was not rebuilt: the Python prototype serialized blueprint rows with explicit nulls, so a Node build is equivalent in meaning but not byte for byte, and the artifact stays as committed until its sources change. Rebuilding living artifacts in a project's CI belongs to the installable Pages workflow (#84).
