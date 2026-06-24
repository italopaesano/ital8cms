# media — TODO

## Manifest serving (decisione differita)

Il `manifest.json5` vive dentro la cartella variante dot-prefixed
(`.{name.ext}.media/`), che koa-classic-server v3 **serve** pubblicamente.
Quindi oggi il manifest è **raggiungibile via URL** (es.
`/media/.foto.jpg.media/manifest.json5`).

- **Stato:** lasciato servito di proposito (non contiene segreti: path + alt +
  dimensioni; può anzi essere utile a un consumer JS lato client).
- **Da valutare in futuro:** oscurarlo se diventasse indesiderato, p.es.
  escludendo `manifest.json5` (o l'estensione `.json5` sotto la media dir) dal
  serving di koa-classic-server, oppure rinominandolo con un prefisso ignorato.
- Vedi il commento `// TODO (manifest serving)` accanto alla scrittura del
  manifest in `lib/variantResolver.js`.

## Scope futuro (non in v1)

- [ ] **Gallerie / caroselli via `.json5`** — file `gallery.{name}.json5` (stesso
      pattern di `bootstrapNavbar`), con `media.renderGallery(name)` che per ogni
      immagine passa dal manifest. Richiederà una `listMedia(folder)` /
      `searchMedia()` nell'API di lettura.
- [ ] **Editing alt-text / titolo** dalla GUI di adminMedia (il campo `alt` nel
      manifest è già previsto; manca solo l'editor).
- [ ] **Thumbnail nella griglia admin** — far usare alla griglia di adminMedia la
      variante `thumb` invece dell'immagine full-size (oggi `media.js` carica
      l'originale rimpicciolito via CSS).
- [ ] **Image picker** — modal di selezione immagini dalla libreria.
