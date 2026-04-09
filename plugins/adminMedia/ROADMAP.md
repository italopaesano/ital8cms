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
- [ ] `pluginConfig.json5` con tutte le opzioni configurabili
- [ ] `pluginDescription.json5`
- [ ] `main.js` skeleton (loadPlugin, getRouteArray, getObjectToShareToOthersPlugin)
- [ ] Registrare sezione `mediaManagement` in `core/admin/adminConfig.json5`
- [ ] `loadPlugin()`: leggere `wwwPath` da `ital8Config.json5`, creare `{wwwPath}/{mediaDir}/` se non esiste

#### Step 2 — Backend: mediaManager.js
- [ ] `listDirectory(relPath)` — lista file e cartelle di un percorso (con metadata: nome, tipo, size, data, dimensioni immagine)
- [ ] `createFolder(relPath, folderName)` — crea sottocartella
- [ ] `renameItem(relPath, newName)` — rinomina file o cartella (warning se cartella)
- [ ] `moveFile(srcRelPath, destRelPath)` — sposta file in altra cartella
- [ ] `deleteFile(relPath)` — elimina file
- [ ] `deleteFolder(relPath, recursive)` — elimina cartella (vuota o ricorsiva)
- [ ] Path traversal protection su tutti i metodi (nessun `../` può uscire dalla media dir)

#### Step 3 — Backend: fileValidator.js
- [ ] Whitelist MIME types (jpg/jpeg/png/gif/webp/avif/bmp/mp4/webm/mov/mp3/wav/ogg/aac/flac)
- [ ] Validazione doppia: estensione file + MIME type reale (letto da buffer, non solo header)
- [ ] Limiti dimensione per categoria (configurabili in `pluginConfig.json5`)
- [ ] Errori chiari: tipo non permesso, file troppo grande

#### Step 4 — Backend: filenameSanitizer.js
- [ ] `sanitize(originalName)` — lowercase, spazi → `_`, rimuovi chars speciali, tronca a max 200 chars
- [ ] `resolveCollision(dir, sanitizedName)` — se file esiste, aggiunge `_1`, `_2`, ecc.
- [ ] Preserva estensione originale dopo sanitizzazione

#### Step 5 — API Routes (main.js)
- [ ] `GET /api/adminMedia/list?path=` — lista contenuto cartella
- [ ] `POST /api/adminMedia/upload?path=` — upload multiplo con multer (va nella cartella corrente)
- [ ] `POST /api/adminMedia/createFolder` — `{ path, name }`
- [ ] `POST /api/adminMedia/rename` — `{ path, newName }` (file o cartella)
- [ ] `POST /api/adminMedia/move` — `{ srcPath, destPath }`
- [ ] `POST /api/adminMedia/deleteFile` — `{ path }`
- [ ] `POST /api/adminMedia/deleteFolder` — `{ path, recursive: bool }`
- [ ] Tutte le route con `access: { requiresAuth: true, allowedRoles: [0, 1] }`

#### Step 6 — UI: index.ejs
- [ ] Layout 2 colonne: sidebar sinistra (tree) + area principale (file grid/list)
- [ ] Breadcrumb navigazione cartella corrente
- [ ] Toolbar: toggle griglia/lista, filtro tipo (Tutti/Immagini/Video/Audio), sort (nome/data/size/tipo)
- [ ] Paginazione (items per pagina configurabile, default 50)
- [ ] Bottone "New Folder" + "Upload"
- [ ] Griglia: thumbnail per immagini, icona per video/audio, nome, dimensione
- [ ] Lista: tabella con icona, nome, tipo, dimensione, data, azioni

#### Step 7 — UI: Operazioni sui File (media.js)
- [ ] Upload: XHR multiplo con progress bar per ogni file
- [ ] Warning area: rinomina automatica, file non supportati, file troppo grandi
- [ ] Rename file: inline edit o modal
- [ ] Rename cartella: modal con warning "il percorso dei file cambierà"
- [ ] Delete file: confirm dialog
- [ ] Delete cartella vuota: confirm dialog
- [ ] Delete cartella con contenuto: confirm dialog con count file ("Questa cartella contiene X file")
- [ ] Move file: modal con folder picker (tree della media directory)
- [ ] Copy URL: click → copia percorso relativo in clipboard

#### Step 8 — UI: Sidebar Tree (media.js)
- [ ] Carica struttura cartelle via `GET /api/adminMedia/list`
- [ ] Espandi/comprimi cartelle nel tree
- [ ] Click su cartella → naviga (aggiorna area principale)
- [ ] Evidenzia cartella corrente
- [ ] Refresh tree dopo: create folder, rename folder, delete folder, move file

#### Step 9 — Sicurezza
- [ ] Path traversal: normalizza percorsi, verifica che restino dentro `{wwwPath}/{mediaDir}/`
- [ ] Validazione MIME reale (magic bytes) oltre all'estensione
- [ ] Limite dimensione file per categoria via multer limits
- [ ] Sanitizzazione nomi file prima di salvare su disco
- [ ] Tutte le route protette da autenticazione (ruoli 0 e 1)

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
