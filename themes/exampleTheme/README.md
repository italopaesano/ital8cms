# exampleTheme - Tema Educativo per ital8cms

Tema di esempio che dimostra tutte le funzionalità del sistema dei temi di ital8cms.

## Struttura

```
exampleTheme/
├── config-theme.json        # Configurazione e dipendenze
├── description-theme.json   # Metadati del tema
├── README.md                # Questa documentazione
├── views/                   # Partials riutilizzabili
│   ├── head.ejs            # Apertura HTML + hook "head"
│   ├── header.ejs          # Apertura body + layout
│   ├── nav.ejs             # Navigazione + hook "nav"
│   ├── main.ejs            # Contenuto + hook "main" e "body"
│   ├── aside.ejs           # Sidebar + hook "aside"
│   └── footer.ejs          # Footer + hook "footer" e "script"
├── templates/               # Template completi
│   └── page.template.ejs   # Template base per nuove pagine
├── assets/                  # Asset statici
│   ├── css/theme.css       # Stili del tema
│   └── js/theme.js         # Script del tema
└── plugins/                 # Override endpoint plugin
    └── simpleAccess/
        └── login/
            ├── template.ejs
            └── style.css
```

## Funzionalità Dimostrate

### 1. Sistema Hook
Ogni partial include gli hook appropriati per permettere ai plugin di iniettare contenuto:
- `head` - CSS, meta tag
- `header` - Banner, notifiche
- `nav` - Menu items
- `main` - Contenuto principale
- `body` - Sezioni aggiuntive
- `aside` - Widget sidebar
- `footer` - Link footer
- `script` - JavaScript

### 2. Asset Management
Gli asset sono in `/assets/` e accessibili via `/theme-assets/`:
```html
<link rel="stylesheet" href="/theme-assets/css/theme.css">
<script src="/theme-assets/js/theme.js"></script>
```

### 3. Dipendenze
Il tema dichiara le sue dipendenze in `config-theme.json`:
```json
{
  "pluginDependency": {
    "bootstrap": "^1.0.0"
  }
}
```

### 4. Metadati
`description-theme.json` contiene informazioni sul tema:
- Versione
- Autore
- Hook supportati
- Feature disponibili

## Come Attivare

In `ital8-conf.json`:
```json
{
  "activeTheme": "exampleTheme"
}
```

Poi riavvia il server.

## Come Usare Come Base

1. Copia questa cartella con un nuovo nome
2. Modifica i file di configurazione
3. Personalizza i partials
4. Aggiungi i tuoi stili in `assets/css/theme.css`
5. Attiva il nuovo tema

## Commenti Educativi

Ogni file contiene commenti dettagliati che spiegano:
- Scopo del file
- Variabili disponibili
- Come funzionano gli hook
- Best practices

Studia i file `.ejs` per capire come costruire un tema completo.

## Autore

ital8cms Team

## Licenza

ISC
