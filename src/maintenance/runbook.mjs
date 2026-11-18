// /runbook (design §11, `maintenance`): deploy, rollback and restore procedures written from the project's own
// release flow (branches, merge method, agent-os release, the CI workflows, the stack's data and hosting layers),
// and the takeover dossier a new maintainer reads first. Facts the repository cannot tell are left as "to fill".
// Existing runbooks are the team's: they are never overwritten without --force.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readStack } from '../stack/stack.mjs'

export const DIR = 'docs/runbooks'

const list = (dir, re) => (existsSync(dir) ? readdirSync(dir).filter((f) => re.test(f)).sort() : [])

/** What the repository says about how it ships: branches, merge method, CI, data and hosting layers, owners, tags. */
export function releaseFacts(cwd, config, { git } = {}) {
  const stack = readStack(cwd)
  const layers = stack?.layers ?? {}
  const tech = (id) => (layers[id] && (layers[id].status ?? 'chosen') !== 'rejected' ? layers[id].tech ?? id : null)
  const owners = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS', '.gitlab/CODEOWNERS'].filter((f) => existsSync(join(cwd, f))).flatMap((f) => readFileSync(join(cwd, f), 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')).flatMap((l) => l.trim().split(/\s+/).slice(1)))
  const tags = git ? String(git(['tag', '--sort=-creatordate']).stdout ?? '').split(/\r?\n/).filter(Boolean).slice(0, 3) : []
  return {
    integration: config.branches?.integration ?? 'development',
    production: config.branches?.production ?? 'main',
    mergeMethod: config.branches?.mergeMethod ?? 'squash',
    requiredChecks: config.branches?.requiredChecks ?? [],
    workflows: [...list(join(cwd, '.github/workflows'), /\.ya?ml$/).map((f) => `.github/workflows/${f}`), ...(existsSync(join(cwd, '.gitlab-ci.yml')) ? ['.gitlab-ci.yml'] : [])],
    data: tech('data-layer'), storage: tech('storage'), hosting: tech('infrastructure') ?? tech('public-frontend') ?? tech('backend-services'), monitoring: tech('monitoring'),
    layers: Object.keys(layers).sort(),
    decisions: list(join(cwd, 'docs/decisions'), /\.md$/).map((f) => `docs/decisions/${f}`),
    owners: [...new Set(owners)], tags,
  }
}

const TODO = { en: (what) => `_to fill: ${what}_`, ro: (what) => `_de completat: ${what}_` }

/** The runbook files, in the docs language. */
export function runbooks(facts, { lang = 'en' } = {}) {
  const t = TODO[lang] ?? TODO.en
  const f = facts
  const ci = f.workflows.length ? f.workflows.map((w) => `\`${w}\``).join(', ') : t('the CI configuration')
  const checks = f.requiredChecks.length ? f.requiredChecks.map((c) => `\`${c}\``).join(', ') : t('the required checks')
  if (lang === 'ro') {
    return {
      [`${DIR}/deploy.md`]: ['# Deploy', '', `Livrarea pleaca de pe \`${f.production}\`. Lucrul se integreaza pe \`${f.integration}\` (${f.mergeMethod}); un release uneste \`${f.integration}\` in \`${f.production}\` cu un merge commit si pune tag-ul.`, '', '## Pasi', '', `1. \`agent-os release plan\`: ce intra, riscurile, verificarile (${checks}).`, '2. `agent-os release open --version <x.y.z>`, apoi review.', '3. `agent-os release finish`: merge commit, tag, note, sync inapoi.', `4. CI (${ci}) face deploy-ul pe ${f.hosting ? `\`${f.hosting}\`` : t('unde ruleaza')}.`, `5. Verifica: ${f.monitoring ? `\`${f.monitoring}\`` : t('monitorizarea')} fara erori noi timp de 15 minute.`, ''].join('\n'),
      [`${DIR}/rollback.md`]: ['# Rollback', '', 'Cand un release strica productia, intai revino, apoi repara.', '', '## Pasi', '', `1. Redeploy pentru tag-ul anterior${f.tags[1] ? ` (\`${f.tags[1]}\`)` : ''} din CI (${ci}), sau din consola ${f.hosting ? `\`${f.hosting}\`` : t('platformei')}.`, `2. Daca release-ul a avut migrari, ruleaza migrarea inversa sau restaureaza (vezi restore.md); ${f.data ? `\`${f.data}\`` : t('baza de date')}.`, '3. Anunta echipa si deschide un incident in jurnal: `agent-os journal add --type incident`.', '4. Repara pe un branch `hotfix/` din productie: `agent-os start <n> --hotfix`.', ''].join('\n'),
      [`${DIR}/restore.md`]: ['# Restore backup', '', `Datele: ${f.data ? `\`${f.data}\`` : t('baza de date')}${f.storage ? `, fisierele: \`${f.storage}\`` : ''}.`, '', '## Pasi', '', `1. Unde sunt backup-urile: ${t('locatia, retentia, cine are acces')}.`, `2. Restaureaza intr-un mediu separat (staging), niciodata direct peste productie: ${t('comanda sau consola')}.`, '3. Verifica datele (numar de randuri, ultimele inregistrari), apoi muta traficul.', '4. Testeaza restore-ul o data pe trimestru si noteaza in jurnal cat a durat.', ''].join('\n'),
      [`${DIR}/takeover.md`]: ['# Dosar de preluare', '', 'Ce citeste primul cine preia proiectul.', '', '## Cum se livreaza', '', `- Branch-uri: \`${f.integration}\` (integrare, ${f.mergeMethod}) → \`${f.production}\` (productie)`, `- Verificari obligatorii: ${checks}`, `- CI: ${ci}`, `- Ultimele release-uri: ${f.tags.length ? f.tags.map((x) => `\`${x}\``).join(', ') : t('niciun tag')}`, '- Proceduri: [deploy](deploy.md), [rollback](rollback.md), [restore](restore.md)', '', '## Ce ruleaza', '', `- Straturi (stack.yaml): ${f.layers.length ? f.layers.join(', ') : t('fara stack.yaml')}`, `- Date: ${f.data ?? t('baza de date')}; gazduire: ${f.hosting ?? t('gazduirea')}; monitorizare: ${f.monitoring ?? t('monitorizarea')}`, '', '## Oameni si decizii', '', `- Responsabili (CODEOWNERS): ${f.owners.length ? f.owners.join(', ') : t('cine raspunde de ce')}`, `- Decizii: ${f.decisions.length ? f.decisions.map((d) => `[${d.split('/').pop()}](../../${d})`).join(', ') : t('nicio decizie inregistrata')}`, `- Acces de predat: ${t('conturi, chei, domenii, facturare')}`, ''].join('\n'),
    }
  }
  return {
    [`${DIR}/deploy.md`]: ['# Deploy', '', `Production ships from \`${f.production}\`. Work is integrated on \`${f.integration}\` (${f.mergeMethod}); a release merges \`${f.integration}\` into \`${f.production}\` with a merge commit and tags it.`, '', '## Steps', '', `1. \`agent-os release plan\`: what goes in, the risks, the checks (${checks}).`, '2. `agent-os release open --version <x.y.z>`, then the review.', '3. `agent-os release finish`: merge commit, tag, notes, sync back.', `4. CI (${ci}) deploys to ${f.hosting ? `\`${f.hosting}\`` : t('where it runs')}.`, `5. Watch ${f.monitoring ? `\`${f.monitoring}\`` : t('the monitoring')} for new errors for 15 minutes.`, ''].join('\n'),
    [`${DIR}/rollback.md`]: ['# Rollback', '', 'When a release breaks production, roll back first and fix second.', '', '## Steps', '', `1. Redeploy the previous tag${f.tags[1] ? ` (\`${f.tags[1]}\`)` : ''} from CI (${ci}), or from the ${f.hosting ? `\`${f.hosting}\`` : t('platform')} console.`, `2. If the release ran migrations, run the down migration or restore (see restore.md); data: ${f.data ? `\`${f.data}\`` : t('the database')}.`, '3. Tell the team and record an incident: `agent-os journal add --type incident`.', '4. Fix on a `hotfix/` branch from production: `agent-os start <n> --hotfix`.', ''].join('\n'),
    [`${DIR}/restore.md`]: ['# Restore a backup', '', `Data: ${f.data ? `\`${f.data}\`` : t('the database')}${f.storage ? `; files: \`${f.storage}\`` : ''}.`, '', '## Steps', '', `1. Where the backups are: ${t('location, retention, who has access')}.`, `2. Restore into a separate environment (staging), never straight over production: ${t('the command or console')}.`, '3. Check the data (row counts, latest records), then move the traffic.', '4. Test the restore once a quarter and record in the journal how long it took.', ''].join('\n'),
    [`${DIR}/takeover.md`]: ['# Takeover dossier', '', 'What a new maintainer reads first.', '', '## How it ships', '', `- Branches: \`${f.integration}\` (integration, ${f.mergeMethod}) → \`${f.production}\` (production)`, `- Required checks: ${checks}`, `- CI: ${ci}`, `- Latest releases: ${f.tags.length ? f.tags.map((x) => `\`${x}\``).join(', ') : t('no tags yet')}`, '- Procedures: [deploy](deploy.md), [rollback](rollback.md), [restore](restore.md)', '', '## What runs', '', `- Layers (stack.yaml): ${f.layers.length ? f.layers.join(', ') : t('no stack.yaml')}`, `- Data: ${f.data ?? t('the database')}; hosting: ${f.hosting ?? t('the hosting')}; monitoring: ${f.monitoring ?? t('the monitoring')}`, '', '## People and decisions', '', `- Owners (CODEOWNERS): ${f.owners.length ? f.owners.join(', ') : t('who answers for what')}`, `- Decisions: ${f.decisions.length ? f.decisions.map((d) => `[${d.split('/').pop()}](../../${d})`).join(', ') : t('none recorded')}`, `- Access to hand over: ${t('accounts, keys, domains, billing')}`, ''].join('\n'),
  }
}
