# Bootstrap Plugin

Plugin per ital8cms che fornisce Bootstrap CSS/JS e Bootstrap Icons attraverso route API dedicate.

## Versione

- **Bootstrap:** 5.3.2
- **Bootstrap Icons:** 1.13.1

## Descrizione

Questo plugin integra Bootstrap e Bootstrap Icons nel CMS, servendo i file statici attraverso route API ottimizzate. I file vengono caricati direttamente da `node_modules`, garantendo sempre l'allineamento con le versioni dichiarate in `pluginConfig.json5`.

## Funzionalità

### 1. Bootstrap CSS
Il plugin serve i file CSS di Bootstrap:
- File minificato e ottimizzato per produzione
- Source map inclusa per debugging

### 2. Bootstrap JavaScript
Bundle JavaScript completo di Bootstrap:
- Include Popper.js integrato
- File minificato e source map

### 3. Bootstrap Icons
Set completo di icone vettoriali:
- 1800+ icone disponibili
- Font files ottimizzati (WOFF e WOFF2)
- CSS dedicato per l'utilizzo delle icone

### 4. Pagina di Test
Route dedicata per testare il corretto funzionamento delle icone Bootstrap.

## Route API Disponibili

Tutte le route sono accessibili con il prefisso `/api/bootstrap/`:

### CSS
```
GET /api/bootstrap/css/bootstrap.min.css
GET /api/bootstrap/css/bootstrap.min.css.map
GET /api/bootstrap/css/bootstrap-icons.min.css
GET /api/bootstrap/css/bootstrap-icons.css
```

### JavaScript
```
GET /api/bootstrap/js/bootstrap.bundle.min.js
GET /api/bootstrap/js/bootstrap.bundle.min.js.map
```

### Font Files
```
GET /api/bootstrap/css/fonts/bootstrap-icons.woff
GET /api/bootstrap/css/fonts/bootstrap-icons.woff2
```

### Test Page
```
GET /api/bootstrap/test-icons
```

## Utilizzo

### Caricamento Automatico via Hook

Il plugin inietta automaticamente Bootstrap nelle pagine attraverso il sistema di hook di ital8cms:

```javascript
// Hook "head" - inietta i file CSS
<link rel='stylesheet' href='/api/bootstrap/css/bootstrap.min.css'>
<link rel='stylesheet' href='/api/bootstrap/css/bootstrap-icons.min.css'>

// Hook "script" - inietta JavaScript
<script src="/api/bootstrap/js/bootstrap.bundle.min.js"></script>
```

Tutte le pagine che utilizzano `pluginSys.hookPage()` riceveranno automaticamente Bootstrap.

### Utilizzo Manuale

Puoi anche includere manualmente i file nelle tue pagine EJS:

```html
<!DOCTYPE html>
<html>
<head>
    <link rel="stylesheet" href="/api/bootstrap/css/bootstrap.min.css">
    <link rel="stylesheet" href="/api/bootstrap/css/bootstrap-icons.min.css">
</head>
<body>
    <!-- Il tuo contenuto -->

    <script src="/api/bootstrap/js/bootstrap.bundle.min.js"></script>
</body>
</html>
```

### Utilizzo delle Icone Bootstrap

Le icone si utilizzano con la classe `bi` seguita dal nome dell'icona:

```html
<!-- Esempi di icone -->
<i class="bi bi-gear"></i>
<i class="bi bi-house"></i>
<i class="bi bi-heart"></i>
<i class="bi bi-star"></i>
<i class="bi bi-check-circle"></i>
```

**Catalogo completo:** [https://icons.getbootstrap.com/](https://icons.getbootstrap.com/)

## Testing

### Pagina di Test Icone

Visita la pagina di test per verificare che Bootstrap Icons funzioni correttamente:

```
http://localhost:3000/api/bootstrap/test-icons
```

La pagina mostra:
- Esempi visivi di icone comuni
- Informazioni tecniche sui path dei file
- Collegamenti alla documentazione ufficiale

### Verifica Manuale

Apri gli strumenti sviluppatore (F12) e:
1. Vai alla tab **Network**
2. Filtra per "bootstrap"
3. Verifica che tutti i file vengano caricati con **HTTP 200 OK**

## Architettura Tecnica

### Gestione dei Path dei Font

Il CSS di Bootstrap Icons referenzia i font con path relativi:

```css
@font-face {
  src: url("fonts/bootstrap-icons.woff2") format("woff2");
}
```

Il plugin serve i font su `/api/bootstrap/css/fonts/` per garantire che il path relativo si risolva correttamente quando il CSS viene caricato da `/api/bootstrap/css/bootstrap-icons.min.css`.

### Stream dei File

I file vengono serviti tramite `fs.createReadStream()` per ottimizzare l'uso della memoria, specialmente per file di grandi dimensioni.

```javascript
ctx.body = fs.createReadStream(filePath);
ctx.set('Content-Type', 'text/css');
```

## Configurazione

### pluginConfig.json5

```json
{
  "active": 1,
  "isInstalled": 1,
  "weight": 0,
  "dependency": {},
  "nodeModuleDependency": {
    "bootstrap": "^5.3.2",
    "bootstrap-icons": "^1.11.0"
  },
  "version": "1.0.0"
}
```

### Installazione Dipendenze

Dopo aver modificato `nodeModuleDependency`, esegui:

```bash
npm install
```

## Note Importanti

### node_modules NON deve essere committato
I file Bootstrap vengono caricati da `node_modules`, che **non deve mai** essere incluso nel repository Git. È già presente in `.gitignore`.

### Aggiornamento Versioni
Per aggiornare Bootstrap o Bootstrap Icons:
1. Modifica le versioni in `pluginConfig.json5` → `nodeModuleDependency`
2. Esegui `npm install`
3. Riavvia il server

### Path Relativi
I path dei font devono corrispondere alla struttura delle route. Modifiche ai path delle route richiedono verifica della corrispondenza con i CSS.

## Troubleshooting

### Le icone non vengono visualizzate

**Problema:** Vedi solo quadrati o caratteri strani al posto delle icone.

**Soluzioni:**
1. Verifica che `bootstrap-icons` sia installato:
   ```bash
   ls node_modules/bootstrap-icons
   ```
2. Controlla che i font siano accessibili:
   ```bash
   curl -I http://localhost:3000/api/bootstrap/css/fonts/bootstrap-icons.woff2
   ```
   Deve restituire `HTTP 200 OK`
3. Apri la pagina di test: `/api/bootstrap/test-icons`

### Errore 404 sui file

**Problema:** I file Bootstrap non vengono trovati.

**Soluzioni:**
1. Verifica che il plugin sia attivo in `pluginConfig.json5`:
   ```json
   { "active": 1 }
   ```
2. Controlla che `node_modules` esista e contenga i pacchetti
3. Riavvia il server

### CSS non applicato

**Problema:** Bootstrap CSS non funziona nelle pagine.

**Soluzioni:**
1. Verifica che la pagina includa `pluginSys.hookPage("head", passData)`
2. Controlla l'ordine di caricamento dei CSS (Bootstrap deve essere caricato prima dei CSS custom)
3. Ispeziona la pagina nel browser per verificare che i `<link>` tag siano presenti nel `<head>`

## Changelog

### v1.0.0 (2025-12-02)
- Fix path font Bootstrap Icons da `/fonts/` a `/css/fonts/`
- Aggiunta pagina di test `/test-icons`
- Documentazione completa del plugin

## Autore

Plugin sviluppato per ital8cms.

## Licenza

Segue la licenza del progetto ital8cms (ISC).

## Risorse Esterne

- [Bootstrap Documentation](https://getbootstrap.com/docs/5.3/)
- [Bootstrap Icons](https://icons.getbootstrap.com/)
- [Bootstrap GitHub](https://github.com/twbs/bootstrap)
- [Bootstrap Icons GitHub](https://github.com/twbs/icons)
