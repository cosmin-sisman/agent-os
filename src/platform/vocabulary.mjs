// The words and paths that differ between platforms. Templates use these values ({{vocab.changeRequest}},
// path segments like __crSkill__), so no template has to ask which platform it is on.

/** @param {'github' | 'gitlab'} type */
export function vocabularyFor(type = 'github') {
  return type === 'gitlab'
    ? { platform: 'GitLab', changeRequest: 'merge request', changeRequests: 'merge requests', cr: 'MR', crSkill: 'mr', crRef: '!', issueRef: '#', epicRef: '&', cli: 'glab', templatesDir: '.gitlab', host: 'https://gitlab.com', crPath: 'merge_requests', treePath: '-/tree' }
    : { platform: 'GitHub', changeRequest: 'pull request', changeRequests: 'pull requests', cr: 'PR', crSkill: 'pr', crRef: '#', issueRef: '#', epicRef: '#', cli: 'gh', templatesDir: '.github', host: 'https://github.com', crPath: 'pull', treePath: 'tree' }
}

/** Skill aliases per platform: the alias name and the skill it stands for. */
export function aliasesFor(type = 'github') {
  return type === 'gitlab' ? [{ alias: 'pr', target: 'mr' }] : []
}
