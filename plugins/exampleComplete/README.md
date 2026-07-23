# Plugin exampleComplete

Plugin di riferimento che dimostra **tutte** le funzionalità del sistema plugin di ital8cms.

## Struttura

```
exampleComplete/
├── main.js                 # Logica del plugin (required)
├── pluginConfig.json5      # Configurazione (required)
├── pluginDescription.json5 # Metadati (required)
├── README.md               # Questa documentazione
└── webPages/               # ⭐ STRONGLY RECOMMENDED per template EJS
    ├── demo.ejs           # Pagina demo
    └── style.css          # Stili
```

**Nota:** La directory `webPages/` è una **convenzione fortemente raccomandata** per organizzare i template EJS nei plugin che servono pagine HTML. Fornisce:
- ✅ **Organizzazione chiara** - Separazione tra logica e presentazione
- ✅ **Consistenza** - Segue il pattern usato in `adminUsers`
- ✅ **Manutenibilità** - Facile localizzare i template
- ✅ **Scalabilità** - Struttura migliore man mano che il plugin cresce

## Funzionalità Dimostrate

### 1. Ciclo di Vita

- `loadPlugin()` - Inizializzazione ad ogni avvio
- `installPlugin()` - Prima installazione
- `upgradePlugin()` - Aggiornamenti versione
- `uninstallPlugin()` - Pulizia risorse

### 2. Route API

| Metodo | Path | Descrizione |
|--------|------|-------------|
| GET | `/demo` | Pagina HTML demo |
| GET | `/info` | Info plugin (JSON) |
| GET | `/search` | Query parameters |
| POST | `/increment` | Body JSON |
| POST | `/create` | Validazione |
| GET | `/protected` | Auth required |
| GET | `/style.css` | File statico |

### 3. Page Hooks

- **head** - CSS inline
- **header** - Banner (se showBanner=true)
- **script** - JavaScript client

### 4. Middleware

- Header `X-Plugin-Example`
- Logging richieste

### 5. Object Sharing

- `getObjectToShareToOthersPlugin()` - Espone API
- `setSharedObject()` - Riceve da altri plugin
- `getObjectToShareToWebPages()` - Dati per template

### 6. Data dir scrivibili (`getWritablePaths`)

- `getWritablePaths(pluginSys, pathPluginFolder)` - Dichiara le directory che il
  plugin deve poter scrivere a runtime (`custom.dataPath`, default `./data`).
- Al boot `pluginSys` la sonda con una scrittura effettiva (crea la dir + write/
  delete di un file temporaneo) e la **pre-crea**; se non è scrivibile, il plugin
  è saltato in modo **graceful** con un box `[STORAGE]` e il boot prosegue (un
  essenziale resta fatale). Vedi `core/storageWritabilityCheck.js`.
- Da implementare **solo** se il plugin scrive dati propri su disco. Il path va
  risolto **offline dal config** (gira prima di `loadPlugin` e nel wizard) e le
  scritture a runtime devono essere **fail-soft** (atomiche + try/catch, mai
  lanciare). Riferimento reale: plugin `analytics`.

## Attivazione

1. In `pluginConfig.json5` imposta `"active": 1`
2. Riavvia il server
3. Visita `/api/exampleComplete/demo`

## Note

Il plugin è disattivato di default (`"active": 0`) per non interferire con l'applicazione. Attivalo solo per studio/riferimento.
