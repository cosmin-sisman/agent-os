---
type: note
refs: ["#117"]
areas: [system]
author: cosmin-sisman
---

# Affected graph: the gate tests changed components and their dependents

The gate understands monorepos: with gateAffected.command, it tests the components that contain a changed file and every component that depends on them, each as an affected:<id> suite with its reason. The graph comes from system.yaml when it exists, else from the workspaces, and depends only on the files and the diff, so the laptop and CI agree. Overlap names the components two changes share. /next still ranks by areas; components there would need issues tagged by component, which nothing records yet.
