<!-- ital8doc v1-1 · type: explain · lang: en -->
# media + adminMedia — Optimized image subsystem (EXPLAIN)

Deep-dive into how ital8cms stores, optimizes and serves media images. Two
plugins cooperate as a **service + admin twin** pair:

| Plugin | Role | Side |
|--------|------|------|
| `media` | Service: owns the variant **schema** and the read **API** | read |
| `adminMedia` | Admin twin: GUI + the **generation engine** (sharp) | write |

## 1. Three layers, not two

The crucial design idea: *serving bytes* and *giving intelligent access* are
different jobs.

| Layer | Owner | Notes |
|-------|-------|-------|
| Serving the file bytes over HTTP | `koa-classic-server` | The media dir lives inside `wwwPath`, so files are already served — nothing to add. |
| Logical access (query, resolve variants, build markup) | **`media`** | Runtime, read-only, headless. |
| Generation & management (upload, variant creation, GUI) | **`adminMedia`** | Write, admin-only. |

`media` used to be an empty stub precisely because layer 1 (serving) is handled
by koa-classic-server. Its real value is layer 2.

## 2. On-disk layout

For an original `foto.jpg` inside `{wwwPath}/{mediaDir}/sub/`:

```
sub/foto.jpg                       ← original (the only entry the GUI lists)
sub/.foto.jpg.media/               ← variant folder, dot-prefixed:
    │                                 • hidden from the file manager listing
    │                                 • still SERVED (koa-classic-server v3 serves dotfiles)
    ├── manifest.json5             ← declares & links every derivative
    ├── web-1920.avif  web-1920.webp  web-1920.jpg
    ├── web-1280.*  web-768.*  web-480.*
    └── thumb-320.avif  thumb-320.webp  thumb-320.jpg
```

- **Folder name**: `.{originalName}.media` (explicit, collision-free between
  `foto.jpg` and `foto.png`).
- **Variant file name**: `{preset}-{width}.{format}` — embeds preset & width,
  **not** the original name, so renaming the original only touches the folder
  name + `manifest.original.file`.

All naming/paths/URLs and manifest IO live in **one** place,
`media/lib/variantResolver.js`, shared by the reader (`media`) and the writer
(`adminMedia`) so they can never disagree.

## 3. The manifest, and why it is decoupled from settings

`manifest.json5` is the **source of truth at read time**. The plugin settings
are the source of truth for what to generate for **new** images. They are
deliberately decoupled:

```
Today:    preset web=[1920,1280,768,480] → upload foto.jpg → manifest lists those
Tomorrow: change widths / add a preset
Result:   • foto.jpg (old) → media reads ITS manifest → still serves its variants
                                                        (no broken links)
          • new uploads    → use the new settings
          • optional: "Regenerate" re-aligns old images to the new settings
```

Rule of thumb: **`media` reading trusts only the manifest, never the current
settings.** Only `adminMedia` looks at settings, and only when generating.

Manifest shape (abridged):

```json5
{
  schemaVersion: 1,
  original: { file: "foto.jpg", width: 4000, height: 3000, bytes: 70768, hash: "sha256:…" },
  alt: "",                       // editorial metadata (future: editable in GUI)
  generatedAt: "2026-06-24T…",
  fallbackFormat: "jpg",         // "png" when the source has transparency
  presets: { thumb: [320], web: [1920,1280,768,480] },   // snapshot of requested widths
  variants: {
    web:   [ { format:"avif", file:"web-1920.avif", width:1920, height:1080, bytes:… }, … ],
    thumb: [ … ],
  },
}
```

`original.hash` enables invalidation ("Generate missing" skips images whose hash
already matches) and stale detection.

## 4. `media` read API

Available in templates as `passData.plugin.media.*` and to other plugins via
`pluginSys.getSharedObject('media')`:

```ejs
<%# Responsive <picture> with AVIF/WebP <source> + multi-width srcset + raster fallback %>
<%- passData.plugin.media.renderPicture('hero.jpg', { sizes: '(max-width:600px) 100vw, 800px', alt: 'Hero' }) %>

<%# URL of the best variant for a format/width %>
<img src="<%= passData.plugin.media.getMediaUrl('hero.jpg', { format: 'webp', width: 800 }) %>">

<%# Raw manifest (sizes, alt, variants) — or null if not generated %>
<% const meta = passData.plugin.media.getMediaMetadata('hero.jpg'); %>
```

- `renderPicture(relPath, opts)` → full `<picture>`; **degrades** to a plain
  `<img>` of the original when no manifest/variants exist (images uploaded via
  FTP or before the feature still render).
- `getMediaUrl(relPath, { format, width, preset })` → variant URL (or original).
- `getMediaMetadata(relPath)` → manifest object or `null`.

`opts`: `alt`, `sizes`, `className`, `loading` (`'lazy'` default), `preset`
(`'web'` default; `'thumb'` for thumbnails).

## 5. Configuration

- **Media directory** (`mediaDir`): global, in `ital8Config.json5`
  (`{wwwPath}/{mediaDir}/`). Read by both plugins.
- **Optimization schema** (`imageOptimization`): in
  `plugins/media/pluginConfig.json5 → custom`:

```json5
imageOptimization: {
  presets: { thumb: { widths: [320] }, web: { widths: [1920,1280,768,480] } },
  formats: ["avif", "webp"],                 // + raster fallback always added
  quality: { jpeg: 80, webp: 78, avif: 50 },
  optimizableExtensions: ["jpg","jpeg","png","webp","avif"], // gif/bmp served as-is
  stripMetadata: true,                       // EXIF dropped (orientation applied first)
  keepOriginal: true,                        // original is the re-derivable source
}
```

## 6. `adminMedia` write side

- **Engine**: `adminMedia/lib/variantGenerator.js` (uses `sharp`). Clean-slate
  per image (wipes the variant folder first, so preset changes leave no stale
  files); no upscaling (widths > source are clamped to the source width);
  fallback raster = jpg for opaque sources, **png** for sources with alpha.
- **sharp is OPTIONAL**: it is intentionally **not** in `nodeModuleDependency`
  (which is fail-fast at boot). It is `require`-d defensively. Without it the
  file manager works normally; optimization is skipped (a boot warning is
  logged). Enable with `npm install sharp`.
- **Eager generation**: variants are built at upload time, right after the file
  lands in its target folder.
- **Variant-aware filesystem** (`adminMedia/lib/mediaManager.js`):
  - `deleteFile` → cascades, removing the variant folder.
  - `renameItem`/`moveFile` → relocate the variant folder and update
    `manifest.original.file`.
  - Folder rename/move needs nothing special: nested variant folders move with
    the folder, and inner manifests are unaffected.
- **Maintenance routes** (admin-only, root/admin `[0,1]`):
  - `POST /api/adminMedia/regenerateVariants` `{ path }` — rebuild variants for a
    file or a whole subtree (re-align to current presets).
  - `POST /api/adminMedia/generateMissing` `{ path }` — only fill gaps (images
    without a manifest, or whose hash no longer matches — e.g. added via FTP).
- **GUI**: an "Optimize" dropdown in the media manager top bar runs the two
  actions on the current folder. Disabled (with a hint) when sharp is absent.

## 7. Plugin wiring

`adminMedia` depends on `media` (`dependency: { media: "^1.1.0" }`), so `media`
loads first. In `adminMedia.loadPlugin` it pulls the schema:

```js
const mediaShared = pluginSys.getSharedObject('media', 'adminMedia');
// → { renderPicture, getMediaUrl, getMediaMetadata, variantResolver,
//     optimizationConfig, mediaDir, mediaDirAbsolute }
```

The `media` read API is exposed pre-`loadPlugin` (pluginSys calls
`getObjectToShareToWebPages()` before `loadPlugin()`), so `media` resolves all
state at **module level**, not in `loadPlugin`.

## 8. Open items

See [`TODO.md`](./TODO.md): manifest is currently served publicly (left on
purpose; may be hidden later), plus future scope (galleries/carousels via
`.json5`, alt-text editing in the GUI, admin-grid thumbnails, image picker).
