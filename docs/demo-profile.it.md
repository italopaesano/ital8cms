<!-- ital8doc v1-1 · tipo: guide · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `demo-profile.md` is a stub until release.
# Profilo di installazione Demo — ital8cms


## Panoramica

ital8cms supporta due **profili di installazione**, scelti **una-tantum** all'avvio del wizard (`npm run start-configure`). La scelta non è commutabile a runtime: per cambiare profilo si reinstalla da capo.

| Profilo | Utente root | Directory `www/` | Flag `demo` |
|---------|-------------|------------------|-------------|
| **Production** (default) | creato interattivamente da terminale | vuota (l'utente la popola) | `false` |
| **Demo** | seed automatico (`demoRoot`) | popolata con contenuti di esempio | `true` |

Il profilo **demo** serve a **provare il sistema** con un CMS già pre-popolato: utenti di esempio (uno per ruolo), contenuti `www/` di esempio, password unica e nota. **Non è una base di produzione.**

> ⚠️ **Sicurezza:** un'installazione demo ha utenti noti con password condivisa (`demomode`). Non esporla mai in produzione.

## Il flag `demo` (runtime)

`ital8Config.json5 → demo` (boolean, default `false`). È **puramente segnaletico**: non altera il comportamento delle richieste, non blocca l'avvio, non cambia la sicurezza. Quando `true`:

- **Avviso al boot** — box ASCII allo startup (`core/demoNotice.js → printDemoBootWarning()`), chiamato da `index.js` solo se `demo === true` (footprint zero altrimenti).
- **Badge admin** — pill discreto "DEMO" in basso a destra nelle pagine admin, iniettato **theme-agnostic** dentro `pluginSys.hookPage('header')` (gated `this.#ital8Conf.demo && passData.isAdminContext`), via `core/demoNotice.js → getDemoBadgeHtml()`. Nessun tema da modificare.
- `passData.demo` è esposto nei tre builder di `index.js` (public, pluginPages, admin) per uso nei template.

## Seeding: due convenzioni (copia-file)

Il seeding demo è **install-time only** (`scripts/lib/demoSeeder.js`, invocato dal ramo demo del wizard). Mai caricato dal runtime del server → impatto sul codice di produzione nullo. Usa **due convenzioni complementari di copia-file** (merge + overwrite, con backup dei file sovrascritti in `backups/demo-<timestamp>/<relpath>`):

**(A) File co-locato `*.demo.json5`** — override di un singolo file dati di un plugin/core:

```
plugins/<p>/userAccount.demo.json5  →  copiato su  plugins/<p>/userAccount.json5
```

Regola: ogni `X.demo.json5` trovato sotto `plugins/` (scan ricorsivo, esclusi `node_modules`, `tests`, `scripts`, dir nascoste) viene copiato sul gemello `X.json5`. Esempio di riferimento: `plugins/adminUsers/userAccount.demo.json5` e `userRole.demo.json5`.

**(B) Mirror `.demoData/`** — contenuti bulk senza un singolo file-target (pagine, immagini, fixture multi-file):

```
.demoData/www/...      →  www/...
.demoData/plugins/<p>/ →  plugins/<p>/...
.demoData/themes/<t>/  →  themes/<t>/...
```

Solo i top-level `www`, `plugins`, `themes` vengono copiati. `.demoData/` è **contenuto spedito** (committato in git, NON gitignorato).

## Hook opzionale `seedDemo(context)`

Per plugin che richiedono seeding **programmatico** (es. INSERT in un DB invece di copiare un JSON), si espone una funzione **opzionale** in `plugins/<p>/scripts/init.js` (l'area install-time, **non** `main.js`):

```javascript
// plugins/<p>/scripts/init.js
module.exports = {
  getQuestions, run,                 // flusso production (esistente)

  // OPZIONALE: seeding programmatico per il profilo demo
  async seedDemo(context) {
    const { pathPluginFolder, logger, projectRoot } = context;
    // ... crea dati di esempio ...
    return { success: true, message: 'Seed demo creato' };
  }
};
```

Il `demoSeeder` invoca `seedDemo()` su ogni plugin che lo espone. Un errore nell'hook viene loggato come warning e **non** interrompe il seeding.

## Buone pratiche per autori di plugin/temi

Per rendere un plugin/tema "demo-ready":
- **File dati** (un override puntuale) → spedisci `<file>.demo.json5` accanto al file reale (convenzione A).
- **Contenuti multipli** (pagine, asset) → mettili sotto `.demoData/plugins/<tuoPlugin>/` o `.demoData/themes/<tuoTema>/` (convenzione B).
- **Logica di seeding** (DB, generazione dinamica) → implementa `seedDemo(context)` in `scripts/init.js`.
- ⚠️ Il seeding demo **sovrascrive** i file reali (con backup): pensa il contenuto demo come usa-e-getta.

## File di riferimento

| File | Scopo |
|------|-------|
| `/ital8Config.json5` | Flag `demo` (default `false`) |
| `/core/demoNotice.js` | Avviso al boot + HTML del badge admin |
| `/core/pluginSys.js` | Iniezione del badge in `hookPage('header')` |
| `/index.js` | `passData.demo` (3 builder) + avviso al boot |
| `/scripts/init.js` | Domanda profilo + ramo demo del wizard |
| `/scripts/lib/demoSeeder.js` | Motore di seeding (convenzioni A + B + hook) |
| `/plugins/adminUsers/userAccount.demo.json5` | Utenti demo di esempio (password `demomode`) |
| `/plugins/adminUsers/userRole.demo.json5` | Ruoli demo (4 hardcoded + 2 custom) |
| `/.demoData/www/` | Contenuti `www/` di esempio (convenzione B) |
| `/tests/unit/demoSeeder.test.js` | Unit test del seeder (12 test, filesystem isolato) |

