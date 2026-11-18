---
type: note
refs: ["#116"]
areas: [system]
author: cosmin-sisman
---

# Contract diffs: breaking changes labelled, consumer owners asked to review

Contract changes are found when the change request is opened, not in production. The specs system.yaml names (OpenAPI, AsyncAPI, GraphQL SDL) are reduced to a surface of operations, parameters, fields, channels and types, and the base and branch versions are compared. Removed surface and stricter inputs are breaking; additions are not. A breaking change labels the change request contract:breaking and asks the owners of every consumer for review, including consumers in other repositories, whose owners are read from their system.yaml at the pinned ref. The comparison never blocks opening the change request: a spec that cannot be read is skipped, so the alert is advisory and the review is the gate.
