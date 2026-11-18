---
type: note
refs: ["#195"]
areas: [ci]
author: cosmin-sisman
---

# Labels workflow: preview without secrets, apply only on the integration branch

Labels can follow agent-os.json and stack.yaml in CI, as an opt-in workflow (ci.labels). The write token is confined: the pull or merge request preview uses only a read token (GitHub: the read-only workflow token on pull_request, never pull_request_target; GitLab: an optional read_api token) and only reports. The apply job alone may write labels, and only on a push to the integration branch; on GitLab, only on the protected branch, with a protected and masked variable. On GitHub an optional deployment environment can require approval. Without a token, a job says which one is missing and changes nothing.
