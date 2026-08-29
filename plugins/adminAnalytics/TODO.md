# adminAnalytics — TODO

## Feature: Analytics Settings Management

The `adminAnalytics` plugin should gain a second admin section (`analyticsSettings`)
that allows administrators to modify the `analytics` plugin's `pluginConfig.json5`
through a GUI form — without having to edit the raw JSON5 file directly.

This mirrors the pattern used in `adminSeo` / `seoManagement/globalSettings.ejs`.

### Planned form fields

| Field | Type | Notes |
|-------|------|-------|
| `gdprCompliance` | Toggle | |
| `sessionSalt` | Text | Show security warning; mask value by default |
| `useAnalyticsCookie` | Toggle | Show GDPR / cookie-banner warning when enabled |
| `analyticsCookieName` | Text | Show only when `useAnalyticsCookie: true` |
| `rotationMode` | Select | none / daily / weekly / monthly |
| `retentionDays` | Number | 0 = disabled |
| `dataPath` | Text | |
| `flushIntervalSeconds` | Number | |

### Implementation notes

- Read current values via `analyticsApi.getConfig()` (already exposed by analytics' shared object)
- Save via atomic filesystem write (temp file + rename, same pattern as adminAccessControl)
- Show a restart-required banner: changes to `rotationMode`, `retentionDays`, `dataPath`,
  and `flushIntervalSeconds` take effect only after server restart (plugin reads config at
  `loadPlugin()` time)
- Changes to `gdprCompliance`, `sessionSalt`, `useAnalyticsCookie` also require restart for
  new events; already-stored events are not retroactively modified
- Register `analyticsSettings` in both:
  - `plugins/adminAnalytics/pluginConfig.json5` → `adminSections` array
  - `core/admin/adminConfig.json5` → `sections` object + `menuOrder` array
- Update `.gitignore` to include the new symlink path:
  `/core/admin/webPages/analyticsSettings`

---

## Note di comportamento

### Export CSV — neutralizzazione delle formule (dalla v3.4.0)

`lib/exportFormatter.js → formatCsv()` antepone un **apice** ai valori stringa che
iniziano con `=`, `+`, `-`, `@`, TAB o CR, perché quei caratteri fanno interpretare
la cella come **formula** da Excel e LibreOffice. È rilevante qui più che altrove:
`path`, `referrer` e `userAgent` sono copiati dalle richieste HTTP, quindi il
contenuto è scelto da **chiunque visiti il sito**, senza alcun accesso privilegiato,
mentre il file lo apre un amministratore.

Due dettagli decidono se la protezione funziona:

- l'apice è applicato **prima** del quoting RFC 4180, così finisce *dentro* le
  virgolette; fuori, spezzerebbe il campo in due colonne;
- agisce sulle **sole stringhe**: un numero non può portare una formula, e
  prefissare un `durationMs: -5` lo renderebbe inutilizzabile nei calcoli.

Conseguenza visibile per chi legge l'export: una cella che *legittimamente* inizia
con uno di quei caratteri mostra l'apice iniziale nel file grezzo. È il
comportamento voluto, ed è il costo minimo della protezione.

## Debito documentale

- [ ] Il plugin non ha `README.it.md` né `EXPLAIN.it.md` — obbligatorio il primo
      secondo ital8doc (`CLAUDE.md` §6). Questo file è un piano di feature, non la
      documentazione del plugin. Finché manca, note come quella qui sopra finiscono
      nel posto sbagliato.
