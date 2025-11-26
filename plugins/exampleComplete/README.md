# Plugin exampleComplete

Plugin di riferimento che dimostra **tutte** le funzionalità del sistema plugin di ital8cms.

## Struttura

```
exampleComplete/
├── main.js                 # Logica del plugin
├── pluginConfig.json      # Configurazione
├── pluginDescription.json # Metadati
├── README.md               # Questa documentazione
└── webPages/
    ├── demo.ejs           # Pagina demo
    └── style.css          # Stili
```

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

## Attivazione

1. In `pluginConfig.json` imposta `"active": 1`
2. Riavvia il server
3. Visita `/api/exampleComplete/demo`

## Note

Il plugin è disattivato di default (`"active": 0`) per non interferire con l'applicazione. Attivalo solo per studio/riferimento.
