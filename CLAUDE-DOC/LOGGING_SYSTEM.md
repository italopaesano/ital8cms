# Sistema di Logging - ital8cms

## Panoramica

Il sistema di logging di ital8cms fornisce un meccanismo centralizzato per la gestione dei log con supporto per livelli di priorità, output colorato e configurazione flessibile.

## Livelli di Log

| Livello | Priorità | Uso | Colore |
|---------|----------|-----|--------|
| DEBUG | 0 | Informazioni dettagliate per sviluppo e debugging | Cyan |
| INFO | 1 | Informazioni sul funzionamento normale | Verde |
| WARN | 2 | Avvisi su potenziali problemi | Giallo |
| ERROR | 3 | Errori critici che richiedono attenzione | Rosso |

## Utilizzo Base

### Importare il Logger

```javascript
const logger = require('./core/logger');
// oppure da un plugin
const logger = require('../../core/logger');
```

### Metodi Disponibili

```javascript
// Log di debug - solo visibile con LOG_LEVEL=DEBUG
logger.debug('nomeModulo', 'Messaggio dettagliato', datiOpzionali);

// Log informativo - funzionamento normale
logger.info('nomeModulo', 'Plugin caricato');

// Warning - potenziali problemi
logger.warn('nomeModulo', 'Configurazione mancante, uso default');

// Errore - problemi critici
logger.error('nomeModulo', 'Errore database', errorObject);
```

### Esempio Output

```
[2025-11-19T10:30:15.123Z] [INFO] [pluginSys] Plugin caricato: admin
[2025-11-19T10:30:15.125Z] [DEBUG] [pluginSys] Validazione dipendenze
[2025-11-19T10:30:15.130Z] [WARN] [pluginSys] Plugin ccxt disabilitato
[2025-11-19T10:30:15.135Z] [ERROR] [pluginSys] Errore caricamento
  Stack: Error: ...
```

## Configurazione

### 1. Variabile d'Ambiente (Priorità Alta)

```bash
# Avvio con livello specifico
LOG_LEVEL=DEBUG npm start
LOG_LEVEL=INFO npm start
LOG_LEVEL=WARN npm start
LOG_LEVEL=ERROR npm start
```

### 2. File di Configurazione (ital8Config.json)

```json
{
  "logLevel": "INFO",
  "debugMode": 1
}
```

**Nota**: Se `logLevel` non è definito ma `debugMode` è 1, il sistema usa DEBUG.

### Priorità Configurazione

1. `LOG_LEVEL` (variabile ambiente) - massima priorità
2. `logLevel` in ital8Config.json
3. `debugMode` in ital8Config.json (se = 1, usa DEBUG)
4. Default: INFO

## Utilizzo nei Plugin

### Esempio Plugin con Logging

```javascript
// plugins/myPlugin/main.js
const logger = require('../../core/logger');

module.exports = {
  loadPlugin(pluginSys, pathPluginFolder) {
    logger.info('myPlugin', 'Inizializzazione plugin');

    try {
      // Operazione
      logger.debug('myPlugin', 'Caricamento configurazione', config);
    } catch (error) {
      logger.error('myPlugin', 'Errore caricamento', error);
      throw error;
    }
  },

  installPlugin(pluginSys, pathPluginFolder) {
    logger.info('myPlugin', 'Installazione in corso');
    // ...
  }
};
```

## Filtraggio e Analisi

### Filtrare Output nel Terminale

```bash
# Solo errori
npm start 2>&1 | grep ERROR

# Solo un modulo specifico
npm start 2>&1 | grep pluginSys

# Escludere DEBUG
npm start 2>&1 | grep -v DEBUG
```

### Salvare in File

```bash
# Tutto in un file
npm start > app.log 2>&1

# Solo errori
npm start 2>&1 | grep ERROR > errors.log
```

### Con PM2 (Produzione)

```bash
# Avvio con livello appropriato
LOG_LEVEL=WARN pm2 start index.js --name ital8cms

# Visualizzare log
pm2 logs ital8cms

# Log in tempo reale
pm2 logs ital8cms --lines 100
```

## API Avanzata

### Verificare Livello Attivo

```javascript
const logger = require('./core/logger');

// Ottieni livello corrente
console.log(logger.getLevel()); // 'INFO'

// Verifica se un livello è attivo
if (logger.isLevelEnabled('DEBUG')) {
  // Esegui operazioni costose solo in debug
  const detailedInfo = computeExpensiveDebugInfo();
  logger.debug('module', 'Info dettagliata', detailedInfo);
}
```

## Best Practices

### 1. Usare Prefissi Consistenti

```javascript
// Buono - prefisso chiaro
logger.info('pluginSys', 'Messaggio');
logger.info('dbApi', 'Query eseguita');

// Evitare - prefissi generici
logger.info('system', 'Messaggio');
```

### 2. Loggare Oggetti Error Correttamente

```javascript
try {
  // operazione
} catch (error) {
  // Buono - passa l'oggetto error
  logger.error('modulo', 'Descrizione errore', error);

  // Evitare - solo il messaggio
  logger.error('modulo', error.message);
}
```

### 3. Usare DEBUG per Informazioni Dettagliate

```javascript
// INFO per eventi significativi
logger.info('modulo', 'Plugin caricato');

// DEBUG per dettagli tecnici
logger.debug('modulo', 'Configurazione caricata', config);
logger.debug('modulo', 'Query SQL', query);
```

### 4. Evitare Log Eccessivi in Loop

```javascript
// Evitare
for (const item of items) {
  logger.debug('modulo', `Processando ${item}`);
}

// Meglio
logger.debug('modulo', `Processando ${items.length} elementi`);
for (const item of items) {
  // processo
}
logger.debug('modulo', 'Elaborazione completata');
```

## Configurazione Consigliata per Ambiente

### Sviluppo

```bash
LOG_LEVEL=DEBUG npm start
```

### Staging/Test

```bash
LOG_LEVEL=INFO npm start
```

### Produzione

```bash
LOG_LEVEL=WARN pm2 start index.js
```

## Estensioni Future

Possibili miglioramenti futuri:

1. **Output su File**: Logging automatico su file con rotazione
2. **Log Strutturati**: Output JSON per analisi automatizzata
3. **Integrazione con Servizi**: Invio a servizi come Datadog, Sentry
4. **Metriche**: Conteggio errori per monitoraggio

## Troubleshooting

### Log Non Visibili

1. Verifica il livello: `echo $LOG_LEVEL`
2. Controlla ital8Config.json per `logLevel` o `debugMode`
3. Assicurati che il modulo usi il logger correttamente

### Colori Non Visualizzati

I colori ANSI potrebbero non funzionare in:
- File di log
- Alcuni terminali Windows
- Pipeline con `| less`

Usa `| cat` per forzare i colori: `npm start | cat`

### Performance

Il logger è sincrono per semplicità. Per applicazioni ad alto throughput, considera:
- Usare livello WARN/ERROR in produzione
- Evitare log in hot paths
- Valutare librerie asincrone (Winston, Pino)

---

**Versione**: 1.0.0
**Data**: 2025-11-19
**Autore**: Sistema di documentazione automatica
