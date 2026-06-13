<!-- ital8doc v1-1 · tipo: EXPLAIN · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `EXPLAIN.md` is a stub until release.
# adminAccessControl — Deep-dive tecnico

> Guida d'uso (config, pattern, campo `access`, API): vedi [`README.it.md`](./README.it.md).

## Perché è fatto così

L'autorizzazione in ital8cms è ibrida: le **rotte dei plugin** si proteggono nel codice (campo `access`, wrappato da `pluginSys`), mentre le **pagine** (che cadono attraverso il router) si proteggono con un **middleware** basato su regole. `adminAccessControl` unisce i due mondi: regole JSON per le pagine + enforcement del campo `access` per le rotte, con un unico modello di pattern e priorità.

## Architettura

| Componente | File | Ruolo |
|-----------|------|-------|
| **AccessManager** | `lib/accessManager.js` | Logica core, creazione del middleware, caricamento regole |
| **PatternMatcher** | `lib/patternMatcher.js` | Motore di matching + calcolo automatico della priorità |
| **RuleValidator** | `lib/ruleValidator.js` | Validazione (sintassi, ruoli, conflitti, pattern) |
| **accessControl.json5** | — | Config centrale (regole hardcoded + custom) |
| **Admin UI** | `adminWebSections/adminAccessControl/index.ejs` | Editor visuale |
| **Access Denied** | `webPages/access-denied.ejs` | Pagina 403 per autenticati senza permesso |

**Flusso:**

```
Richiesta → middleware AccessManager → PatternMatcher → regola matchata?
                                              ↓                 ↓ no
                                           sì ↓            applica defaultPolicy
                                              ↓
                          controllo auth → controllo ruoli → consenti/nega
```

## Sistema di validazione

**Al boot** (`RuleValidator`) — se fallisce, **il server NON parte** (errori a console):
1. Sintassi JSON5 valida.
2. Campi obbligatori (`requiresAuth`, `allowedRoles`) presenti in ogni regola.
3. Pattern validi (niente caratteri invalidi, regex che compila).
4. Esistenza ruoli: tutti gli ID esistono in `/plugins/adminUsers/userRole.json5`.
5. Nessun conflitto con rotte di plugin: le custom rules **non** definiscono rotte possedute da un plugin.
6. Regole hardcoded con `editable: false`.

**A runtime (admin UI)** — oltre alle verifiche di boot:
1. **Immutabilità hardcoded:** le `hardcodedRules` inviate coincidono con le originali (confronto JSON byte-per-byte).
2. Nessuna modifica che rompa le sessioni attive.

Se fallisce: modifica respinta, file invariato.

## Pagina Access Denied

`webPages/access-denied.ejs` (URL `/pluginPages/adminAccessControl/access-denied.ejs`). Mostrata quando l'utente è **autenticato ma privo del ruolo richiesto** (alternativa user-friendly al 403). Contiene: info utente (username, ruoli correnti), ruoli richiesti dalla pagina, link alla home, nota per gli admin.

## Guida alla migrazione (aggiungere `access` a plugin esistenti)

Le vecchie rotte senza `access`:

```javascript
{ method: 'GET', path: '/my-route', handler: async (ctx) => { /* ... */ } }
```

vanno aggiornate aggiungendo il campo:

```javascript
{ method: 'GET', path: '/my-route',
  access: { requiresAuth: false, allowedRoles: [] },   // o true / [0,1,...]
  handler: async (ctx) => { /* ... */ } }
```

Passi: 1) identifica il tipo di rotta (pubblica/autenticata/per-ruolo); 2) aggiungi il campo `access`; 3) verifica che il server parta senza errori di validazione; 4) testa i permessi.

## Troubleshooting

| Sintomo | Causa / Soluzione |
|---------|-------------------|
| Server non parte: `Configuration validation failed … Invalid regex pattern` | Sintassi regex errata in `accessControl.json5` |
| `FATAL: Rule conflict detected!` (pattern matcha una rotta di plugin) | Rimuovi il pattern dalle custom rules — le rotte plugin dichiarano `access` nel codice |
| `Cannot modify hardcodedRules section` | Modifica solo `customRules`; le hardcoded proteggono path critici |
| `Role 999 not found in userRole.json5 (WARNING)` | Assicurati che l'ID ruolo esista in `userRole.json5` |
| Pattern che non matcha | Verifica sintassi (esatto/wildcard/`regex:`) e priorità (vince il più specifico); controlla i log AccessManager |

## Best practice

1. Usa le **hardcoded rules** per i path critici (es. `/admin/**` → `[0, 1]`, `editable: false`).
2. Preferisci pattern **specifici** ai wildcard ampi.
3. **Sempre** il campo `access` nelle rotte dei plugin, esplicito.
4. Usa i **ruoli custom** (100+) per permessi granulari.
5. Documenta l'intento dei pattern con un commento.
6. ⚠️ Non definire rotte di plugin nel JSON (le rotte plugin si gestiscono nel codice; il JSON è per le pagine non-plugin).
7. ⚠️ Testa la default policy (capisci il fallback, scegli l'`action` giusta).

## Test

Testabile manualmente (curl su rotte pubbliche/protette, login con/senza ruolo, editor admin) e via suite automatica (Jest/supertest: rotta pubblica 200, rotta protetta → redirect login, rotta admin per non-admin → access-denied).

## Limitazioni e sviluppi futuri

- [ ] Access simulator nella UI (testa URL contro le regole)
- [ ] Audit log dei tentativi/dinieghi
- [ ] Regole basate su IP / fascia oraria
- [ ] Rate limiting per-rotta
- [ ] Funzione template `passData.accessControl.check()` per controllo a livello di pagina
- [ ] Export/import delle configurazioni
- [ ] Rule builder visuale (senza editare JSON)
