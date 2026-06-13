<!-- ital8doc v1-1 · tipo: README · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `README.md` is a stub until release.
# adminAccessControl

Sistema di **controllo accessi basato su pattern** per gestire i permessi su tutte le pagine e rotte di ital8cms. Risoluzione automatica delle priorità, protezione obbligatoria delle rotte e interfaccia admin per editare le regole.

> 📖 Deep-dive (architettura dei componenti, sistema di validazione, default policy, migrazione, troubleshooting, best practice): vedi [`EXPLAIN.it.md`](./EXPLAIN.it.md).

## Cosa fa

- **Pattern matching:** esatto, wildcard (`*`, `**`) e regex.
- **Priorità automatica:** i pattern più specifici vincono i conflitti.
- **Campo `access` obbligatorio:** tutte le rotte dei plugin DEVONO dichiarare i requisiti di accesso.
- **Architettura ibrida:** regole JSON per le pagine + protezione a livello di codice (campo `access`) per le rotte dei plugin.
- **Admin UI:** editor visuale con sintassi JSON5.
- **Validazione al boot:** previene configurazioni errate (il server non parte se invalide).
- **Regole hardcoded immutabili:** le protezioni core non sono modificabili dalla UI.

## File di configurazione: `accessControl.json5`

```json5
// This file follows the JSON5 standard - comments and trailing commas are supported
{
  "version": "1.0.0",

  // REGOLE HARDCODED (immutabili, non modificabili via UI)
  "hardcodedRules": {
    "/admin/**": {
      "requiresAuth": true,
      "allowedRoles": [0, 1],   // solo root (0) e admin (1)
      "priority": 100,           // opzionale: auto-calcolata se omessa
      "editable": false
    }
  },

  // REGOLE CUSTOM (definite dall'utente, gestite via admin UI)
  "customRules": {
    "/my-protected-page": { "requiresAuth": true, "allowedRoles": [0, 1, 102] },
    "/public/**": { "requiresAuth": false, "allowedRoles": [] },
    "regex:^/download/.*\\.pdf$": { "requiresAuth": true, "allowedRoles": [0, 1, 2] }
  },

  // DEFAULT POLICY (quando nessuna regola matcha)
  "defaultPolicy": {
    "action": "allow",   // "allow" | "deny" | "requireAuth"
    "redirectOnDenied": "/pluginPages/adminUsers/login.ejs"
  }
}
```

**Campi di una regola:**

| Campo | Obbligo | Tipo | Descrizione |
|-------|---------|------|-------------|
| `requiresAuth` | sì | Boolean | Se serve l'autenticazione |
| `allowedRoles` | sì | Array\<Number\> | ID dei ruoli abilitati (vuoto = tutti gli autenticati) |
| `priority` | no | Number | Priorità manuale (auto-calcolata se omessa) |
| `editable` | no | Boolean | Marca le regole hardcoded (`false` = immutabile) |

## Pattern matching e priorità automatica

| Tipo | Priorità | Esempio | Matcha |
|------|----------|---------|--------|
| Esatto | 1000 | `/admin/users` | solo `/admin/users` |
| Regex (prefisso `regex:` obbligatorio) | 500 | `regex:^/download/.*\\.pdf$` | `/download/file.pdf` |
| Wildcard singolo `*` | 300 | `/admin/*` | `/admin/users` (non `/admin/users/edit`) |
| Wildcard ricorsivo `**` | 100 | `/admin/**` | `/admin/users`, `/admin/users/edit` (tutti i livelli) |

Quando più pattern matchano lo stesso URL, **vince il più specifico**: `Esatto (1000) > Regex (500) > Wildcard-singolo (300) > Wildcard-ricorsivo (100)`. Per `/admin/users`, l'esatto vince sul `/admin/**`.

## Campo `access` obbligatorio nelle rotte dei plugin

**CRITICO:** ogni rotta di un plugin **DEVE** includere il campo `access`. La sua assenza causa un **errore fatale al boot**.

```javascript
getRouteArray(router, pluginSys, pathPluginFolder) {
  return [
    { method: 'GET', path: '/public-page',
      access: { requiresAuth: false, allowedRoles: [] },          // pubblica
      handler: async (ctx) => { ctx.body = 'Public content'; } },
    { method: 'POST', path: '/admin/delete-user',
      access: { requiresAuth: true, allowedRoles: [0, 1] },        // solo root/admin
      handler: async (ctx) => { /* ... */ } }
  ];
}
```

**Pattern comuni:**

| Accesso | Configurazione |
|---------|----------------|
| Pubblico (no auth) | `{ requiresAuth: false, allowedRoles: [] }` |
| Tutti gli autenticati | `{ requiresAuth: true, allowedRoles: [] }` |
| Solo admin | `{ requiresAuth: true, allowedRoles: [0, 1] }` |
| Solo root | `{ requiresAuth: true, allowedRoles: [0] }` |
| Ruoli specifici | `{ requiresAuth: true, allowedRoles: [0, 1, 102, 105] }` |

## Default policy

Quando un URL non matcha alcun pattern, decide la `defaultPolicy`:

| `action` | Comportamento |
|----------|---------------|
| `"allow"` | Tutti possono accedere (default) |
| `"deny"` | Nessuno può accedere (403 per tutti) |
| `"requireAuth"` | Solo autenticati (redirect al login se non loggato) |

## Admin UI

Accesso: `/admin/adminAccessControl/` (ruoli root/admin `[0, 1]`). Editor JSON5 dell'intero file con validazione in tempo reale (sintassi, esistenza ruoli, validità pattern, conflitti), protezione delle regole hardcoded (mostrate ma non modificabili) e reference dei pattern. Al salvataggio valido le regole vengono salvate e il middleware si ricarica.

## API (route, ruoli `[0, 1]`)

| Metodo | Path | Descrizione |
|--------|------|-------------|
| `GET` | `/api/adminAccessControl/rules` | Tutte le regole (hardcoded + custom) |
| `GET` | `/api/adminAccessControl/rules-json` | `accessControl.json5` come stringa |
| `POST` | `/api/adminAccessControl/rules` | Salva le regole modificate (valida prima) |
| `POST` | `/api/adminAccessControl/test-access` *(futuro)* | Testa un URL contro le regole correnti |

## File

| File | Scopo |
|------|-------|
| `main.js` | Logica plugin, middleware, endpoint |
| `accessControl.json5` | Regole di accesso (hardcoded + custom) |
| `lib/accessManager.js` | Logica core, creazione middleware, caricamento regole |
| `lib/patternMatcher.js` | Motore di pattern matching + calcolo priorità |
| `lib/ruleValidator.js` | Motore di validazione (sintassi, ruoli, conflitti, pattern) |
| `adminWebSections/adminAccessControl/index.ejs` | Editor visuale |
| `webPages/access-denied.ejs` | Pagina 403 custom |
