// The GitHub adapter's planning board (Projects v2): ids, fields, items and the status sync, mixed into GitHubTracker.

import { CliError } from '../cli/errors.mjs'

/** Mixed into GitHubTracker (github.mjs): the same `this` and the same interface. */
export class BoardMethods {
  // ── Board (Projects v2) ──────────────────────────────────────────────────

  /** The board's ids and single-select fields, or null (with a warning) when there is no board or no scope. */
  boardInfo() {
    if (this.cache.board !== undefined) return this.cache.board
    if (!this.board?.number) { this.cache.board = null; return null }
    const q = `query($o:String!,$n:Int!){ repositoryOwner(login:$o){ ... on ProjectV2Owner { projectV2(number:$n){ id fields(first:50){ nodes{ ... on ProjectV2SingleSelectField { id name options { id name } } } } } } } }`
    try {
      const p = this.gh.graphql(q, { o: this.board.owner, n: this.board.number })?.repositoryOwner?.projectV2
      if (!p) throw new CliError(`board ${this.board.owner}/${this.board.number} not found`)
      this.cache.board = { id: p.id, fields: Object.fromEntries(p.fields.nodes.filter((f) => f.name).map((f) => [f.name, f])) }
    } catch (err) {
      const scope = /scope|INSUFFICIENT_SCOPES|project/i.test(err.output ?? err.message)
      this.warnings.push(scope
        ? `the board was skipped: the token lacks the "project" scope (fix: gh auth refresh -s project)`
        : `the board was skipped: ${err.message}`)
      this.cache.board = null
    }
    return this.cache.board
  }

  /** Every item on the board with its issue number, state and single-select values; null without a board. */
  boardItems() {
    const board = this.boardInfo()
    if (!board) return null
    const q = 'query($id:ID!,$after:String){ node(id:$id){ ... on ProjectV2 { items(first:100, after:$after){ pageInfo{ hasNextPage endCursor } nodes{ id content{ ... on Issue { number state repository{ nameWithOwner } } } fieldValues(first:20){ nodes{ ... on ProjectV2ItemFieldSingleSelectValue { name field{ ... on ProjectV2SingleSelectField { name } } } } } } } } } }'
    const out = []
    let after = null
    for (let page = 0; page < 30; page++) {
      const items = this.gh.graphql(q, { id: board.id, ...(after ? { after } : {}) })?.node?.items
      for (const n of items?.nodes ?? []) {
        if (!n.content?.number || (n.content.repository?.nameWithOwner && n.content.repository.nameWithOwner !== this.repo)) continue
        out.push({ itemId: n.id, number: n.content.number, state: String(n.content.state).toLowerCase(), fields: Object.fromEntries((n.fieldValues?.nodes ?? []).filter((v) => v?.field?.name).map((v) => [v.field.name, v.name])) })
      }
      if (!items?.pageInfo?.hasNextPage) break
      after = items.pageInfo.endCursor
    }
    return out
  }

  /** Creates a board linked to the repository with the default fields (Status comes with every board). */
  createBoard({ title, fields }, { dryRun = false } = {}) {
    const steps = [`create the project "${title}" owned by ${this.repo.split('/')[0]} and link it to ${this.repo}`, ...Object.entries(fields).map(([name, options]) => `add the field ${name}: ${options.join(', ')}`)]
    if (dryRun) return { dryRun: true, steps }
    const [owner, name] = this.repo.split('/')
    const ids = this.gh.graphql('query($o:String!,$n:String!){ repositoryOwner(login:$o){ id } repository(owner:$o,name:$n){ id } }', { o: owner, n: name })
    const project = this.gh.graphql('mutation($o:ID!,$t:String!,$r:ID!){ createProjectV2(input:{ownerId:$o,title:$t,repositoryId:$r}){ projectV2{ id number url } } }', { o: ids.repositoryOwner.id, t: title, r: ids.repository.id }).createProjectV2.projectV2
    for (const [fieldName, options] of Object.entries(fields)) {
      this.gh.graphql('mutation($p:ID!,$n:String!,$o:[ProjectV2SingleSelectFieldOptionInput!]!){ createProjectV2Field(input:{projectId:$p,dataType:SINGLE_SELECT,name:$n,singleSelectOptions:$o}){ clientMutationId } }', { p: project.id, n: fieldName, o: options.map((o) => ({ name: o, color: 'GRAY', description: '' })) })
    }
    return { number: project.number, url: project.url, steps }
  }

  /** Places an issue on the board and sets a single-select field (Status by default). Without a board: a warning. */
  setStatus(number, value, { field = 'Status', dryRun = false } = {}) {
    if (dryRun) return { dryRun: true, requests: [{ graphql: 'addProjectV2ItemById + updateProjectV2ItemFieldValue', board: this.board ?? null, field, value }] }
    const board = this.boardInfo()
    if (!board) return { number, skipped: true, warnings: this.warnings }
    const f = board.fields[field]
    const option = f?.options.find((o) => o.name.toLowerCase() === String(value).toLowerCase())
    if (!option) throw new CliError(`the board has no ${field} "${value}"`, { hint: `options: ${(f?.options ?? []).map((o) => o.name).join(', ') || 'none'}` })
    const item = this.gh.graphql('mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p,contentId:$c}){ item { id } } }', { p: board.id, c: this.ids(number).nodeId }).addProjectV2ItemById.item.id
    this.gh.graphql('mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){ updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){ clientMutationId } }', { p: board.id, i: item, f: f.id, o: option.id })
    return { number, [field.toLowerCase()]: option.name }
  }
}
