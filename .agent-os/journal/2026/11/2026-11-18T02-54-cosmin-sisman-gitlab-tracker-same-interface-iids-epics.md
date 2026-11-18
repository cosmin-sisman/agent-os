---
type: decision
refs: ["#92", "#91", "#15", "#16"]
areas: [platform, github]
author: cosmin-sisman
---

# GitLab tracker: same interface, iids, epics on Premium, fallbacks on Free

`src/tracker/gitlab.mjs` implements the tracker interface on GitLab through `glab api` (REST v4 and GraphQL), so /ticket, /start, /next, /pr and /ship behave the same way on both platforms. Tests use a fake glab only; nothing was created on any GitLab instance.

Decisions:
- On Free, an issue cannot be the child of another issue: child tasks are a separate work item type. `planParent` therefore treats subItems "tasks" as missing and uses the fallback (a Parent line plus a checklist item). On Premium the issue is attached to the epic. This is the issue's test scenario.
- The interface gained `labelChangeRequest` and `commentChangeRequest`, because GitLab merge requests and issues are separate resources (on GitHub a PR is an issue for labels and comments). /pr and /ship use them.
- Board status is a `status::<value>` scoped label that replaces the other status labels. GitLab boards list issues by label, so this works on every tier.
- Checks are the head pipeline's jobs, with the latest retry winning per name. This is the same rule as `checksOf` on GitHub (#16).
- Review threads are resolvable discussions with the id `<iid>:<discussion>`, because replying needs the merge request's iid.
- The glab client gained REST with JSON bodies, GraphQL and retries on 429/5xx. The capability probe uses the same client.
