{{! area: docs }}
# Postgres (pachetul stack-postgres)

- **Orice schimbare de schema este o migrare**, comisa cu codul care are nevoie de ea. Nu modifica o migrare care a rulat undeva; adauga una noua.
- **Migrarile sunt reversibile sau spun de ce nu.** Pasii distructivi (stergerea unei coloane sau tabele, restrangerea unui tip) merg in migrarea lor, dupa ce codul nu mai foloseste ce sterg.
- **Tabelele mari se schimba fara sa blocheze scrierile:** indexurile se creeaza `CONCURRENTLY`; o coloana se adauga nullable sau cu un default constant, se completeaza in loturi, apoi se adauga constrangerea.
- **Fiecare cheie straina are un index**, iar fiecare interogare pe o cale fierbinte se verifica cu `EXPLAIN` inainte de livrare.
- **Fara `SELECT *` in codul aplicatiei**; numeste coloanele. Parametrii se leaga mereu, nu se concateneaza in SQL.
- **Row-level security** este activ pe fiecare tabela accesibila printr-un API public (Supabase, PostgREST). O schimbare de politica primeste un test pentru cine poate si cine nu poate citi.
- Tranzactiile sunt scurte: fara apeluri de retea sau asteptari dupa utilizator in ele.
