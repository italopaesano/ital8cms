# analytics plugin

Plugin per il monitoraggio del traffico di ital8cms.

## Cosa fa

Intercetta ogni richiesta HTTP tramite middleware Koa e salva gli eventi in formato **JSONL** nella directory `data/`. Non produce output HTML, non ha endpoint API propri: è un collettore di dati puro. La visualizzazione e l'elaborazione delle statistiche è delegata al futuro plugin **adminAnalytics**.

## Formato dati: perché JSONL e non JSON

Il formato scelto è **JSONL** (`.jsonl` — JSON Lines): un file di testo dove ogni riga è un oggetto JSON indipendente.

**Vantaggi rispetto a `.json`:**

| Operazione | `.json` (array) | `.jsonl` |
|------------|----------------|----------|
| Append un evento | Leggi + parse + riscrivi tutto il file O(n) | `fs.appendFileSync()` O(1) |
| Leggi tutti gli eventi | Parse diretto | Split per righe + parse |
| Crash-safe | Può corrompere il file se il crash avviene durante la riscrittura | Ogni riga è indipendente |
| Streaming | No | Sì (riga per riga) |

Con JSONL, aggiungere un evento significa scrivere una sola riga in append. Non si legge mai il file esistente durante la scrittura.

## Struttura evento

```json
{
  "timestamp":       "2026-04-13T10:30:00.000Z",
  "path":            "/about",
  "method":          "GET",
  "statusCode":      200,
  "durationMs":      45,
  "referrer":        "https://google.com",
  "userAgent":       "Mozilla/5.0...",
  "isBot":           false,
  "botName":         null,
  "ipArea":          "151.38",
  "sessionHash":     "a3f8c2d1...",
  "isAuthenticated": false,
  "isAdmin":         false
}
```

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `timestamp` | string | ISO 8601 UTC |
| `path` | string | Path URL della richiesta |
| `method` | string | Metodo HTTP (GET, POST, ...) |
| `statusCode` | number | Codice risposta HTTP |
| `durationMs` | number | Durata totale della richiesta in ms |
| `referrer` | string\|null | Header Referer, null se assente |
| `userAgent` | string\|null | Header User-Agent, null se assente |
| `isBot` | boolean | true se riconosciuto come bot/crawler |
| `botName` | string\|null | Nome del bot (es. "Googlebot"), null se non bot |
| `ipArea` | string | IP anonimizzato (area geografica) |
| `sessionHash` | string\|null | HMAC-SHA256 del session ID, null se non disponibile |
| `isAuthenticated` | boolean | true se l'utente ha una sessione autenticata |
| `isAdmin` | boolean | true se la richiesta riguarda il pannello admin |

## Privacy & GDPR

### Anonimizzazione IP (`gdprCompliance: true`, default)

L'IP grezzo non viene mai salvato. Viene conservata solo l'area di rete:

- **IPv4**: primi 2 ottetti → `"151.38.123.45"` diventa `"151.38"`
- **IPv6**: primi 2 gruppi + `::` → `"2001:0db8:85a3::..."` diventa `"2001:0db8::"`
- **IPv4-mapped IPv6** (`::ffff:x.x.x.x`): trattato come IPv4

### Hash sessione

Il session ID viene hashato con HMAC-SHA256 prima di essere salvato. Il salt è configurabile in `pluginConfig.json5` (`sessionSalt`).

**⚠ Cambia il `sessionSalt` in produzione** con una stringa casuale di almeno 32 caratteri.

### Cookie analytics (`useAnalyticsCookie: false`, default)

Per default il plugin hasha il cookie di sessione Koa già esistente (`koa:sess`). Questo non aggiunge nessun cookie extra → nessun cookie banner necessario.

Se si abilita `useAnalyticsCookie: true` per il tracking cross-sessione, si imposta un cookie dedicato che **rientra nella categoria dei cookie di tracciamento ai sensi del GDPR (Reg. UE 2016/679) e della Direttiva ePrivacy**. Il titolare del sito è responsabile di implementare un cookie banner con consenso esplicito prima di attivare questa opzione.

## File e rotazione

I file vengono salvati in `plugins/analytics/data/` con nome dipendente dalla `rotationMode`:

| Modalità | File | Esempio |
|----------|------|---------|
| `"none"` | `analytics.jsonl` | File unico crescente |
| `"daily"` | `analytics-YYYY-MM-DD.jsonl` | `analytics-2026-04-13.jsonl` |
| `"weekly"` | `analytics-YYYY-WXX.jsonl` | `analytics-2026-W15.jsonl` |
| `"monthly"` | `analytics-YYYY-MM.jsonl` | `analytics-2026-04.jsonl` (**default**) |

La rotazione mensile è il buon compromesso tra dimensione dei file e granularità storica.

## Retention

All'avvio del server i file più vecchi di `retentionDays` (default: 365) vengono automaticamente eliminati. Impostare `retentionDays: 0` per disabilitare la pulizia automatica.

## Filtro path

Vengono tracciati solo i path corrispondenti a **pagine reali**:

- ✅ Path con estensione `.ejs`
- ✅ Path senza estensione (clean URL con `hideExtension` attivo)
- ❌ Path `/api/**` (route API dei plugin)
- ❌ Path `/public-theme-resources/**` e `/admin-theme-resources/**`
- ❌ File con estensioni statiche (`.css`, `.js`, `.png`, `.jpg`, `.ico`, `.woff`, ecc.)

## Bot detection

Tutti i bot vengono **tracciati** (non filtrati), ma marcati con `isBot: true` e `botName`. Questo permette ad adminAnalytics di distinguere traffico umano da bot e di identificare crawler SEO, monitoring, scraper, ecc.

La lista include circa 50 firme di bot noti (motori di ricerca, social, SEO, monitoring, HTTP client generici).

## Buffer e performance

Gli eventi vengono accumulati in RAM e scritti su disco in batch ogni `flushIntervalSeconds` secondi (default: 2s). Questo riduce drasticamente le operazioni I/O rispetto a una scrittura per ogni richiesta.

- `flushIntervalSeconds: 0` → scrittura immediata (debug)
- `flushIntervalSeconds: 2` → default (raccomandato)
- In caso di SIGTERM o SIGINT, il buffer viene sempre flushato prima dello shutdown

## Shared object (per adminAnalytics)

Il plugin espone un'API agli altri plugin tramite `getSharedObject`:

```javascript
const analyticsApi = pluginSys.getSharedObject('analytics');

analyticsApi.listDataFiles()         // → string[] — path assoluti ai file .jsonl
analyticsApi.readEventsFromFile(path) // → object[] — eventi parsati
analyticsApi.flushNow()              // forza flush immediato del buffer
analyticsApi.getBufferSize()         // → number — eventi in buffer
analyticsApi.getConfig()             // → object — copia della configurazione
analyticsApi.getDataDir()            // → string — path directory dati
```

## Configurazione

Tutte le opzioni sono in `pluginConfig.json5` → blocco `custom`. Vedere i commenti nel file per la documentazione completa di ogni opzione.

## Struttura file

```
plugins/analytics/
├── main.js                    # Entry point: middleware + loadPlugin + shared object
├── pluginConfig.json5         # Configurazione (privacy, storage, buffer)
├── pluginDescription.json5    # Metadati plugin
├── README.md                  # Questo file
├── data/                      # File JSONL generati (esclusi da git)
│   └── analytics-YYYY-MM.jsonl
└── lib/
    ├── privacyFilter.js       # Anonimizzazione IP, hash sessione (GDPR)
    ├── botDetector.js         # Rilevamento bot da User-Agent (~50 firme)
    ├── eventCollector.js      # Costruisce oggetto evento da ctx Koa
    ├── fileManager.js         # Scrittura JSONL, rotazione file, retention
    └── bufferManager.js       # Buffer in memoria con flush periodico
```
