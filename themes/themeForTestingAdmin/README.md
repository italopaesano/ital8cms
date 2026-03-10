# defaultAdminTheme

Tema predefinito per l'interfaccia di amministrazione di ital8cms.

## Caratteristiche

- **Layout Dashboard:** Design pulito e professionale per pannelli amministrativi
- **Responsive:** Ottimizzato per desktop e mobile
- **Hook completi:** Supporta tutti gli hook del sistema plugin
- **Theme Resources:** CSS e JavaScript personalizzabili

## Struttura

```
defaultAdminTheme/
├── views/                      # Partials EJS
│   ├── head.ejs               # <head> con meta e CSS
│   ├── header.ejs             # Header admin
│   ├── nav.ejs                # Navigazione
│   ├── aside.ejs              # Sidebar
│   ├── main.ejs               # Contenuto principale
│   └── footer.ejs             # Footer + scripts
├── themeResources/            # Asset statici
│   ├── css/theme.css          # Stili admin
│   └── js/theme.js            # JavaScript admin
├── themeConfig.json5           # Configurazione (isAdminTheme: true)
└── themeDescription.json5      # Metadati tema
```

## Configurazione

Il tema è marcato come amministrativo tramite:

```json
{
  "isAdminTheme": true
}
```

Questo garantisce che possa essere usato solo come tema admin e non come tema pubblico.

## Dipendenze

- **bootstrap:** ^1.0.0 (plugin)
- **admin:** ^1.0.0 (plugin)
- **ejs:** ^3.0.0 (npm)

## Utilizzo

Imposta il tema in `ital8Config.json5`:

```json
{
  "adminActiveTheme": "defaultAdminTheme"
}
```

## Personalizzazione

### CSS

Modifica `/themeResources/css/theme.css` per personalizzare:
- Colori header/sidebar
- Layout responsive
- Tipografia

### JavaScript

Modifica `/themeResources/js/theme.js` per aggiungere:
- Interazioni UI
- Validazione form
- Ajax calls

## Note

Questo tema è specifico per l'amministrazione e include:
- Layout sidebar + main content
- Header con info utente (via hook)
- Navigazione admin (via hook)
- Footer con copyright

Tutti i contenuti sono iniettati tramite hook dei plugin per massima flessibilità.
