{{! area: docs }}
# TypeScript

Se aplica pentru {{paths}}.

- Modul `strict` activ; fara `any` (foloseste `unknown` si restrange). Tipurile descriu datele, nu implementarea.
- Construieste cai din `import.meta.url` cu `fileURLToPath(new URL(…, import.meta.url))`, niciodata cu `.pathname`: se strica pe Windows si in foldere cu spatii.
- Nu importa niciodata dintr-un fisier de test: runner-ul ii inregistreaza testele inca o data. Helper-ele comune stau in `__fixtures__/` langa cod.
- Trateaza orice promise: `await` sau return; fara promise-uri lasate in aer.
{{#if lowAi}}
## Citeste documentatia intai

Agentii cunosc slab {{lowAi}}: citeste documentatia oficiala pentru versiunea folosita inainte sa scrii cod si citeaz-o in change request.
{{/if}}
