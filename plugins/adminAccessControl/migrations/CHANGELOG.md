# Changelog delle migrazioni di `adminAccessControl`

Storico degli step dichiarati in [`migrations.json5`](./migrations.json5), dal
più recente.

Il clock è la `schemaVersion` del **descrittore** (`pluginConfig.default.json5`),
che è la versione di struttura dell'intero pacchetto.

---

## v3 → v4 — pattern ai segnaposti di percorso

**Con script** (`from-v3-to-v4.js`), automatico e idempotente. È il primo step
del plugin, e il primo che **rinomina** chiavi invece di aggiungerne.

I pattern passano dai letterali (`/admin/**`) ai segnaposti (`{{admin}}/**`), e
le quattro regole in forma pulita delle pagine di `pluginPages` vengono rimosse
perché ora si derivano al caricamento quando `hideExtension` è attivo per quella
zona. Dieci regole dichiarate diventano sei, col ruleset in vigore identico.

**Perché serve uno script:** il merge additivo sa solo aggiungere chiavi, qui si
rinomina e si rimuove. **Perché è testuale:** i commenti del file vivo sono metà
del suo valore (91 righe su un file appena materializzato) e una
riserializzazione li perderebbe. **Perché è fail-soft:** su un file riformattato
gli ancoraggi non combaciano, e un file di sicurezza non si riscrive a tentoni —
si dichiara cosa non è stato possibile convertire.

Senza questo step l'installazione resta funzionante — i letterali sono ancora
accettati e il `baseline` di zona protegge il pannello comunque — ma le regole
esplicite sul pannello diventano inerti appena `adminPrefix` non è quello di
default. Il file descriverebbe una protezione che non è quella in vigore.

→ [`from-v3-to-v4.md`](./from-v3-to-v4.md) · [`docs/decisions/path-zones.it.md`](../../../docs/decisions/path-zones.it.md)
