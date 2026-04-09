# adminMedia Plugin — ROADMAP

## Decisioni Architetturali

| Punto | Decisione |
|-------|-----------|
| Directory media | Relativa a `wwwPath` (da `ital8Config.json5`), configurable via `mediaDir` in `pluginConfig.json5`. Default: `"media"` → `{wwwPath}/media/` |
| Serving file | koa-classic-server esistente (nessuna nuova istanza — la media dir è dentro `wwwPath`) |
| Upload library | `@koa/multer` (multipart/form-data; salva su disco, non in RAM) |
| Progress upload | Client-side via `XMLHttpRequest.upload.onprogress` (no server changes needed) |
| UI navigazione cartelle | Albero laterale (tree view) |
| UI vista file | Griglia (thumbnail) + Lista (tabella), toggle tra le due |
| UI move file | Modal con folder picker |
| Collisione nome file | Rinomina automatica (`foto.jpg` → `foto_1.jpg`) + warning visivo |
| Sanitizzazione nomi | Lowercase, spazi → `_`, rimuovi caratteri speciali. Es: `Mia Foto (24)!.jpg` → `mia_foto_24.jpg` |
| URL copiato | Relativo (es. `/media/foto.jpg`) |
| Ruoli accesso | Root (0) e Admin (1) |
| sectionId admin | `mediaManagement` |

---

## v1 — adminMedia (scope attuale)

### Struttura Plugin

```
plugins/adminMedia/
├── main.js                              # Entry point, routes, multer setup
├── pluginConfig.json5                   # Config (mediaDir, limiti, paginazione)
├── pluginDescription.json5              # Metadata plugin
├── ROADMAP.md                           # Questo file
├── lib/
│   ├── mediaManager.js                  # Operazioni filesystem (list, delete, move, mkdir, rename)
│   ├── fileValidator.js                 # Validazione tipo MIME e dimensione
│   └── filenameSanitizer.js             # Sanitizzazione e gestione collisioni nome file
└── adminWebSections/
    └── mediaManagement/
        ├── index.ejs                    # UI principale (tree sidebar + area contenuto)
        ├── media.css                    # Stili UI
        └── media.js                    # Client-side: XHR upload, progress, drag-drop tree, modal
```

### Tipi File Supportati

| Categoria | Estensioni | Limite |
|-----------|-----------|--------|
| Immagini | jpg, jpeg, png, gif, webp, avif, bmp | 10 MB (configurabile) |
| Video | mp4, webm, mov | 500 MB (configurabile) |
| Audio | mp3, wav, ogg, aac, flac | 50 MB (configurabile) |

**Esclusi:** SVG (rischio XSS), PDF e documenti (fuori scope media).

### Features da Implementare

#### Step 1 — Setup & Struttura Plugin
- [x] Creare struttura directory plugin
- [x] `pluginConfig.json5` con tutte le opzioni configurabili
- [x] `pluginDescription.json5`
- [x] `main.js` con loadPlugin, getRouteArray, getObjectToShareToWebPages
- [x] Registrare sezione `mediaManagement` in `core/admin/adminConfig.json5`
- [x] `loadPlugin()`: leggere `wwwPath` da `ital8Config.json5`, creare `{wwwPath}/{mediaDir}/` se non esiste

#### Step 2 — Backend: mediaManager.js
- [x] `listDirectory(relPath)` — lista file e cartelle con metadata (nome, tipo, size, data)
- [x] `createFolder(relPath, folderName)` — crea sottocartella
- [x] `renameItem(relPath, newName)` — rinomina file o cartella
- [x] `moveFile(srcRelPath, destRelPath)` — sposta file in altra cartella
- [x] `deleteFile(relPath)` — elimina file
- [x] `deleteFolder(relPath, recursive)` — elimina cartella (vuota o ricorsiva)
- [x] `buildFolderTree()` — albero cartelle per move picker
- [x] `resolveAbsPath()` — utility per main.js
- [x] Path traversal protection su tutti i metodi

#### Step 3 — Backend: fileValidator.js
- [x] Whitelist estensioni per categoria (image/video/audio)
- [x] Validazione doppia: estensione + magic bytes reali (16 bytes)
- [x] Limiti dimensione per categoria (configurabili in `pluginConfig.json5`)
- [x] Errori chiari: tipo non permesso, file troppo grande, magic bytes non corrispondenti

#### Step 4 — Backend: filenameSanitizer.js
- [x] `sanitize(originalName)` — lowercase, spazi → `_`, rimuovi chars speciali, tronca a 200 chars
- [x] `resolveCollision(dir, sanitizedName)` — aggiunge `_1`, `_2`, ecc. fino a `_9999`
- [x] Preserva estensione originale dopo sanitizzazione

#### Step 5 — API Routes (main.js)
- [x] `GET /api/adminMedia/list?path=` — lista contenuto cartella
- [x] `POST /api/adminMedia/upload?path=` — upload multiplo con @koa/multer
- [x] `POST /api/adminMedia/createFolder` — `{ path, name }`
- [x] `POST /api/adminMedia/rename` — `{ path, newName }` (file o cartella)
- [x] `POST /api/adminMedia/move` — `{ srcPath, destPath }`
- [x] `POST /api/adminMedia/deleteFile` — `{ path }`
- [x] `POST /api/adminMedia/deleteFolder` — `{ path, recursive: bool }`
- [x] `GET /api/adminMedia/tree` — albero cartelle per move picker
- [x] Tutte le route con `access: { requiresAuth: true, allowedRoles: [0, 1] }`

#### Step 6 — UI: index.ejs + media.css
- [x] Layout 2 colonne: sidebar sinistra (tree) + area principale
- [x] Breadcrumb navigazione
- [x] Toolbar: toggle griglia/lista, filtro tipo, sort con direzione
- [x] Paginazione configurabile (default 50)
- [x] Bottone "New Folder" + "Upload"
- [x] Modals: New Folder, Rename, Delete File, Delete Folder, Move File
- [x] Toast "URL copied"

#### Step 7+8 — UI: media.js
- [x] Upload XHR multiplo con progress bar
- [x] Warning area: rinomina automatica, errori upload
- [x] Rename file/cartella con modal (warning per cartelle)
- [x] Delete file/cartella con confirm + count contenuto
- [x] Move file: modal con folder picker tree
- [x] Copy URL relativo in clipboard
- [x] Sidebar tree: espandi/comprimi, navigazione, evidenzia corrente
- [x] Griglia e lista con tutte le azioni per file e cartelle
- [x] Filtro, sort, paginazione client-side

#### Step 9 — Sicurezza
- [x] Path traversal: `safeResolve()` in mediaManager verifica che ogni path resti dentro la media root
- [x] Validazione MIME reale (magic bytes) in fileValidator
- [x] Limite dimensione per categoria via multer + fileValidator
- [x] Sanitizzazione nomi file in filenameSanitizer
- [x] Tutte le route protette da autenticazione (ruoli 0 e 1)
- [x] `escHtml()` client-side per tutti i valori dinamici nel DOM

---

## Futuro — Plugin `media` (scope non ancora definito)

Da approfondire e implementare in una fase successiva:

- [ ] Metadata file: alt text, titolo, tag (con `mediaIndex.json5`)
- [ ] API programmatica per altri plugin: `getMediaUrl()`, `getMediaMetadata()`, `searchMedia()`
- [ ] Shared object verso altri plugin (es. plugin SEO può leggere immagini OG)

## Futuro — Image Picker

- [ ] Modal visuale per selezionare immagini dalla media library
- [ ] Integrazione con sistema di creazione pagine (da studiare)
- [ ] Inserimento URL immagine in editor testo/configurazione

## Futuro — Compressione & Ottimizzazione

- [ ] Resize automatico immagini al caricamento
- [ ] Generazione thumbnail per preview
- [ ] Conversione formato (es. auto-convert a WebP)
- [ ] Richiederebbe libreria esterna (es. `sharp`)

## Futuro — Miglioramenti UI

- [ ] Drag-and-drop upload (oltre al button "Scegli file")
- [ ] Preview video/audio inline
- [ ] Bulk operations: seleziona multipli → elimina, sposta
- [ ] Ricerca per nome file

---

## Note Tecniche

- `@koa/multer` gestisce upload multipart. Il middleware viene applicato solo alle route di upload (non globale).
- I file vengono salvati su disco da multer prima della validazione MIME (magic bytes). Se la validazione fallisce, il file viene eliminato.
- La media directory viene creata automaticamente al `loadPlugin()` se non esiste.
- In debug mode (`debugMode >= 1`): log dettagliato di ogni operazione.
- Nessun database: tutte le info derivano dal filesystem (nessun `mediaIndex.json5` in v1).
