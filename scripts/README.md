# Sistema di Inizializzazione ital8cms

Sistema di wizard interattivo per configurazione iniziale e setup plugin.

## 📋 Panoramica

Il sistema di inizializzazione permette di:
- Configurare le impostazioni globali di ital8cms
- Inizializzare plugin che richiedono setup (es. creazione utente root)
- Gestire backup automatici durante inizializzazione
- Supportare re-inizializzazione selettiva

## 🚀 Utilizzo

### Prima Inizializzazione

Dopo aver installato ital8cms:

```bash
npm install
npm run start-configure
```

Il wizard ti guiderà attraverso:
1. **Configurazione globale** - Modifica impostazioni in `ital8Config.json5`
2. **Inizializzazione plugin** - Setup plugin che lo richiedono (es. adminUsers)

### Re-Inizializzazione

Se hai già inizializzato il sistema, il wizard rileva lo stato esistente e ti permette di:
- Mantenere la configurazione esistente
- Re-inizializzare solo configurazione globale
- Re-inizializzare solo plugin specifici
- Re-inizializzare tutto (backup automatico)

```bash
npm run start-configure
```

## 📁 Struttura File

```
/scripts/
├── init.js                    # Entry point wizard
├── initState.json5            # Stato inizializzazione (gitignored)
└── lib/
    ├── configWizard.js        # Wizard configurazione globale
    ├── pluginScanner.js       # Scansiona plugin con init
    ├── pluginInitRunner.js    # Esegue init plugin
    ├── stateManager.js        # Gestione stato
    ├── backupManager.js       # Backup automatici
    ├── logger.js              # Logging con date italiane
    └── validators.js          # Validatori input

/plugins/{pluginName}/
└── scripts/
    ├── init.js                # Script init plugin (opzionale)
    └── initState.json5        # Stato plugin (gitignored)

/logs/
└── init-DD-MM-YYYY_HH-MM-SS.log  # Log operazioni

/backups/
└── init-DD-MM-YYYY_HH-MM-SS/     # Backup automatici
    ├── global/                    # Config globali
    └── plugins/                   # File plugin
```

## 🔌 Creare Plugin con Inizializzazione

### 1. Crea struttura directory

```bash
mkdir -p plugins/myPlugin/scripts
```

### 2. Crea `plugins/myPlugin/scripts/init.js`

```javascript
module.exports = {
  /**
   * Domande per inquirer
   */
  getQuestions() {
    return [
      {
        type: 'input',
        name: 'setting1',
        message: 'Inserisci impostazione:',
        validate: (value) => value.length > 0 || 'Campo obbligatorio'
      }
    ]
  },

  /**
   * Descrizione dettagliata (opzionale)
   */
  getDescription() {
    return `
Descrizione dettagliata del plugin...
    `.trim()
  },

  /**
   * File da backuppare (opzionale)
   */
  getFilesToBackup(pathPluginFolder) {
    const path = require('path')
    return [
      path.join(pathPluginFolder, 'config.json5')
    ]
  },

  /**
   * Esegue inizializzazione
   */
  async run(answers, context) {
    const { pathPluginFolder, logger } = context

    try {
      // Logica inizializzazione
      logger.info('Inizializzazione in corso...')

      // ... codice ...

      return {
        success: true,
        message: 'Inizializzazione completata!',
        data: { /* dati opzionali */ }
      }
    } catch (error) {
      return {
        success: false,
        message: `Errore: ${error.message}`,
        error: error
      }
    }
  }
}
```

### 3. Dichiara dipendenze (opzionale)

In `plugins/myPlugin/pluginConfig.json5`:

```json5
{
  "active": 1,
  "isInstalled": 1,

  // Se il tuo plugin dipende da altri plugin già inizializzati
  "initDependencies": ["adminUsers"],

  "dependency": {},
  "custom": {}
}
```

### 4. Testa inizializzazione

```bash
npm run start-configure
```

Il wizard rileverà automaticamente il plugin e lo includerà nel processo.

## 📝 File di Stato

### Stato Globale (`scripts/initState.json5`)

```json5
{
  "version": "1.0.0",
  "initialized": true,
  "initDate": "29/12/2025 10:30:15",
  "lastUpdate": "29/12/2025 10:30:15",

  "global": {
    "completed": true,
    "configModified": true,
    "backupPath": "./backups/init-29-12-2025_10-30-15/global/"
  },

  "plugins": {
    "adminUsers": {
      "completed": true,
      "initDate": "29/12/2025 10:32:45",
      "backupPath": "./backups/init-29-12-2025_10-30-15/plugins/adminUsers/"
    }
  }
}
```

### Stato Plugin (`plugins/{name}/scripts/initState.json5`)

```json5
{
  "initialized": true,
  "initDate": "29/12/2025 10:32:45",
  "backupPath": "../../backups/init-29-12-2025_10-30-15/plugins/adminUsers/"
}
```

## 🔄 Backup e Rollback

### Backup Automatico

Il sistema crea backup automatici prima di ogni modifica:
- **Config globali** → `backups/init-{timestamp}/global/`
- **File plugin** → `backups/init-{timestamp}/plugins/{pluginName}/`

### Rollback Manuale

In caso di problemi, ripristina i file da backup:

```bash
# Esempio: ripristina ital8Config.json5
cp backups/init-29-12-2025_10-30-15/global/ital8Config.json5 ./ital8Config.json5

# Esempio: ripristina file plugin
cp -r backups/init-29-12-2025_10-30-15/plugins/adminUsers/* ./plugins/adminUsers/
```

## 🔍 Log

I log di ogni esecuzione sono salvati in:

```
logs/init-DD-MM-YYYY_HH-MM-SS.log
```

Formato log:
```
[DD/MM/YYYY HH:MM:SS] [LEVEL] Messaggio
```

Livelli:
- `INFO` - Informazioni generali
- `SUCCESS` - Operazioni riuscite
- `WARNING` - Avvisi
- `ERROR` - Errori

## ❓ FAQ

### Come faccio a ri-inizializzare solo un plugin?

```bash
npm run start-configure
# Seleziona: "Re-inizializza solo plugin specifici"
# Scegli il plugin dalla lista
```

### Come faccio a saltare l'inizializzazione plugin?

Durante il wizard, seleziona:
```
? Vuoi procedere con l'inizializzazione dei plugin?
  > No, salta inizializzazione plugin
```

### I backup vengono eliminati automaticamente?

No, i backup restano in `/backups/` e devono essere eliminati manualmente quando non più necessari.

### Posso automatizzare l'inizializzazione (CI/CD)?

Non direttamente, il wizard è interattivo. Per automatizzazione, considera di:
1. Creare configurazioni predefinite
2. Saltare init e configurare manualmente via script
3. Utilizzare variabili d'ambiente

## 🐛 Troubleshooting

### Errore: "Funzione run() mancante"

Il file `scripts/init.js` del plugin deve esportare la funzione `run()`:

```javascript
module.exports = {
  async run(answers, context) {
    // ...
  }
}
```

### Errore: "Dipendenza circolare rilevata"

Due o più plugin hanno dipendenze circolari in `initDependencies`. Esempio:

```
pluginA → dipende da → pluginB
pluginB → dipende da → pluginA  ❌ ERRORE
```

Soluzione: Rimuovi la dipendenza circolare.

### Il wizard non rileva il mio plugin

Verifica che esista il file:
```
plugins/myPlugin/scripts/init.js
```

Il plugin viene rilevato automaticamente se questo file esiste.

## 📚 Riferimenti

- [CLAUDE.md](../CLAUDE.md) - Documentazione completa progetto
- [package.json](../package.json) - Dipendenze e script npm
- [Plugin adminUsers](../plugins/adminUsers/scripts/init.js) - Esempio implementazione

---

**Versione:** 1.0.0
**Data:** 29/12/2025
**Autore:** Sistema ital8cms
