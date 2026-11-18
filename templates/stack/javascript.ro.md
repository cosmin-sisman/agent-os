{{! area: docs }}
# JavaScript

Se aplica pentru {{paths}}.

- ES modules moderne; `const` implicit, fara `var`. Prefera modulele incorporate in locul unei dependente noi.
- Construieste cai din `import.meta.url` cu `fileURLToPath(new URL(…, import.meta.url))`, niciodata cu `.pathname`.
- Nu importa dintr-un fisier de test; helper-ele de test stau in `__fixtures__/`.
- Trateaza orice promise: `await` sau return.
{{#if lowAi}}
## Citeste documentatia intai

Agentii cunosc slab {{lowAi}}: citeste documentatia oficiala pentru versiunea folosita inainte sa scrii cod si citeaz-o in change request.
{{/if}}
