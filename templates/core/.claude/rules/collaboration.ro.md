{{! area: docs }}
# Lucrul in echipa

In acest repository lucreaza mai multi oameni, fiecare cu sesiunile lui de agent, pe laptopul lui. {{vocab.platform}} e singura stare comuna: issue-uri, {{vocab.changeRequests}}, comentarii, board-ul si git. Nimic nu se coordoneaza printr-un fisier tinut local de o singura persoana.

## Preluarea unei sarcini

- Lucreaza pe un issue doar dupa ce l-ai preluat: `agent-os start <n>` te asigneaza si creeaza branch-ul legat de issue. Preia-l inainte de prima modificare, nu dupa.
- Un {{vocab.changeRequest}} inchide un singur issue. Munca mai mare se imparte in sub-issue-uri, fiecare preluat separat.
- Verifica ce schimba ceilalti: `agent-os start` si `agent-os pr preflight` arata munca suprapusa. La suprapunere, vorbeste cu autorul inainte sa mergeti amandoi mai departe.

## Issue-ul altcuiva

- Nu prelua un issue asignat altcuiva si nu face push pe branch-ul lui. Intreaba intai in issue ("@nume, pot sa-l preiau sau lucram impreuna?"). Foloseste `agent-os start --force` doar dupa ce e de acord.
- Nu actualiza branch-ul altcuiva cu baza (merge sau rebase) decat daca iti cere. `/ship` trimite un branch ramas in urma inapoi la autor.

## Comentarii

- Citeste tot firul inainte sa actionezi pe un issue sau pe un {{vocab.changeRequest}}.
- Raspunde in limba comentariului la care raspunzi. Comentariile noi folosesc limba issue-urilor (**{{lang.issues}}**) si limba {{vocab.changeRequests}} (**{{lang.prs}}**).
- Spune ce ai facut si ce a ramas. O decizie luata intr-un fir se citeaza in intrarea de jurnal a {{vocab.changeRequest}} care o implementeaza.

## Starea personala si starea echipei

Se comit (acordul echipei sau istoria, cate un fisier per intrare, deci fara conflicte): `agent-os.json`, regulile si skill-urile din `.claude/`, `.agent-os/journal/`, `.agent-os/lessons/`, `.agent-os/registry/`, `.agent-os/lock.json` si `.agent-os/base/`.

Nu se comit niciodata (personale, per laptop): `.agent-os/local.json`, `.agent-os/cache/`, `.claude/settings.local.json`, `.claude/worktrees/`, secrete si token-uri. `agent-os doctor` esueaza cand git urmareste oricare dintre ele.

## CI e garantia

Hook-urile locale ajuta, dar pot fi ocolite. Verificarile obligatorii (`ci`, `agent-os/loop`) ruleaza pe fiecare {{vocab.changeRequest}} si nu pot fi ocolite. Nu ocoli niciodata o verificare care esueaza. Repara cauza sau intreaba in {{vocab.changeRequest}}.
