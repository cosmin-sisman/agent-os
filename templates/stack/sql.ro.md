{{! area: docs }}
# SQL

Se aplica pentru {{paths}}.

- Orice schimbare de schema e o migratie, cu calea inapoi (o migratie down sau un rollback scris).
- Doar interogari parametrizate; niciodata SQL construit din input de la utilizator.
- Instructiunile distructive (DROP, TRUNCATE, DELETE fara WHERE) cer un plan de backup in change request; /release intreaba inainte de livrare.
- Row-level security sau o verificare explicita de acces pe fiecare tabel cu date ale utilizatorilor.
{{#if lowAi}}
## Citeste documentatia intai

Agentii cunosc slab {{lowAi}}: citeste documentatia oficiala pentru versiunea folosita inainte sa scrii cod si citeaz-o in change request.
{{/if}}
