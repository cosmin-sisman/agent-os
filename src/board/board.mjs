// The planning board (GitHub Projects v2), optional: Status, Priority and Size kept in step with the issues. It needs
// the token's `project` scope; without it the board is skipped with one warning and every other command works.
// Only values that differ are written, so a sync of a board that is already right sends nothing.

import { labelId } from '../workflow/next.mjs'

/** The default fields: Status is built into every board; Priority and Size mirror the labels. Iteration is left to teams. */
export const BOARD_FIELDS = { Priority: ['P0', 'P1', 'P2', 'P3'], Size: ['XS', 'S', 'M', 'L', 'XL'] }

/** What the board should say about an issue. */
export function desiredFields(issue, { inReview = false } = {}) {
  const ids = (issue.labels ?? []).map(labelId)
  const status = issue.state === 'closed' ? 'Done' : inReview ? 'In Review' : issue.assignees?.length ? 'In Progress' : 'Todo'
  const priority = ids.find((l) => /^priority:p\d$/.test(l))?.slice(-2).toUpperCase() ?? null
  const size = ids.find((l) => l.startsWith('size:'))?.slice(5).toUpperCase() ?? null
  return { Status: status, ...(priority ? { Priority: priority } : {}), ...(size ? { Size: size } : {}) }
}

/**
 * The changes a sync would make: issues to add, and fields that differ. Values the board has no option for are
 * reported, not invented (the board's fields belong to its owner).
 * @param {object} tracker a tracker with boardInfo, boardItems and openIssues
 * @param {{ only?: number }} [options]
 */
export function planBoardSync(tracker, { only } = {}) {
  const board = tracker.boardInfo()
  if (!board) return { skipped: true, warnings: tracker.warnings ?? [], changes: [], missing: [] }
  const items = tracker.boardItems() ?? []
  const byNumber = new Map(items.map((i) => [i.number, i]))
  const open = tracker.openIssues()
  const issues = only ? [tracker.get(only)].map((i) => ({ ...i, milestone: null })) : open
  const changes = []
  const missing = []
  const want = (issue) => {
    const desired = desiredFields(issue)
    const item = byNumber.get(issue.number)
    for (const [field, value] of Object.entries(desired)) {
      const f = board.fields[field]
      if (!f) { missing.push(`the board has no ${field} field (value ${value} for #${issue.number})`); continue }
      if (!f.options.some((o) => o.name.toLowerCase() === value.toLowerCase())) { missing.push(`the board's ${field} has no option "${value}" (#${issue.number})`); continue }
      if ((item?.fields?.[field] ?? null) !== value) changes.push({ number: issue.number, field, from: item?.fields?.[field] ?? null, to: value, add: !item })
    }
  }
  for (const i of issues) want(i)
  // Closed issues still on the board: only their Status can be stale.
  if (!only) for (const item of items.filter((x) => x.state === 'closed' && x.fields.Status !== 'Done')) want({ number: item.number, state: 'closed', labels: [], assignees: [] })
  return { skipped: false, board: { id: board.id }, changes, missing: [...new Set(missing)], warnings: tracker.warnings ?? [] }
}

/** Applies a sync plan, one field at a time (adding the issue is part of setting its first field). */
export function applyBoardSync(tracker, plan) {
  for (const c of plan.changes) tracker.setStatus(c.number, c.to, { field: c.field })
  return { applied: plan.changes.length }
}
