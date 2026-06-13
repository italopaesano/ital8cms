<!-- ital8doc v1-1 · tipo: reference · lang: it · ref -->
# Esempi Pratici: Admin Plugin Pages Standard

Questo documento mostra esempi concreti di come apparirebbe il codice con le diverse alternative proposte.

---

## 📦 Scenario: Plugin "adminMedia" con 2 Sezioni

Vogliamo creare un plugin per gestire media files con due sezioni admin:
1. **Galleria** - Visualizzazione e gestione immagini
2. **Upload** - Caricamento bulk di file

---

## 🔵 ATTUALE (v1.5.0)

### Struttura Plugin

```
plugins/adminMedia/
├── main.js
├── pluginConfig.json5
├── pluginDescription.json5
├── gallery/                    # Sezione 1
│   ├── index.ejs              # Lista immagini
│   ├── imageView.ejs          # Dettaglio immagine
│   └── imageEdit.ejs          # Modifica metadati
└── upload/                     # Sezione 2
    └── index.ejs              # Form upload
```

### pluginConfig.json5

```json5
{
  "active": 1,
  "isInstalled": 1,
  "weight": 50,

  "adminSections": [
    "gallery",      // Sezione 1 (array di stringhe)
    "upload"        // Sezione 2
  ],

  "dependency": {
    "bootstrap": "^1.0.0"
  }
}
```

### /core/admin/adminConfig.json5

```json5
{
  "sections": {
    "gallery": {
      "type": "plugin",
      "plugin": "adminMedia",
      "enabled": true,
      "required": false,
      "label": "Galleria Media",       // ❌ Duplicazione metadata
      "icon": "🖼️",
      "description": "Visualizza e gestisci immagini"
    },
    "upload": {
      "type": "plugin",
      "plugin": "adminMedia",
      "enabled": true,
      "required": false,
      "label": "Carica Media",
      "icon": "📤",
      "description": "Caricamento bulk di file"
    }
  },

  "menuOrder": [
    "usersManagment",
    "rolesManagment",
    "gallery",           // ❌ Gestione manuale ordine
    "upload",
    "systemSettings"
  ]
}
```

### URL Generate

```
/admin/gallery/index.ejs
/admin/gallery/imageView.ejs?id=123
/admin/gallery/imageEdit.ejs?id=123
/admin/upload/index.ejs
```

### Symlink Creati

```bash
/core/admin/webPages/gallery → /plugins/adminMedia/gallery/
/core/admin/webPages/upload → /plugins/adminMedia/upload/
```

---

## 🟢 ALTERNATIVA A: Metadata nel Plugin

### pluginConfig.json5

```json5
{
  "active": 1,
  "isInstalled": 1,
  "weight": 50,

  "adminSections": [
    {
      "id": "gallery",
      "label": "Galleria Media",          // ✅ Metadata nel plugin
      "icon": "🖼️",
      "description": "Visualizza e gestisci immagini",
      "menuWeight": 100,                  // ✅ Peso menu nel plugin
      "enabled": true
    },
    {
      "id": "upload",
      "label": "Carica Media",
      "icon": "📤",
      "description": "Caricamento bulk di file",
      "menuWeight": 110,
      "enabled": true
    }
  ],

  "dependency": {
    "bootstrap": "^1.0.0"
  }
}
```

### /core/admin/adminConfig.json5 (Opzionale, solo override)

```json5
{
  "sections": {
    // ✅ Opzionale! Se non specificato, usa metadata da plugin
    "gallery": {
      "enabled": false    // Override: disabilita sezione
    }
    // "upload" non specificato → usa tutto da plugin
  },

  // ✅ menuOrder opzionale (usa menuWeight se non specificato)
  "menuOrder": []  // Vuoto = ordina per menuWeight automaticamente
}
```

### Logica Merge (AdminSystem)

```javascript
// Pseudo-codice
function getEffectiveConfig(sectionId, pluginMetadata, centralMetadata) {
  return {
    label: centralMetadata?.label || pluginMetadata.label,      // central override
    icon: centralMetadata?.icon || pluginMetadata.icon,
    enabled: centralMetadata?.enabled ?? pluginMetadata.enabled,
    menuWeight: centralMetadata?.menuWeight ?? pluginMetadata.menuWeight
  }
}
```

### Risultato

```
✅ Plugin self-contained (tutti metadata dentro)
✅ Override centrali opzionali
✅ menuOrder auto-generato da menuWeight
❌ Logica merge più complessa
```

---

## 🟡 ALTERNATIVA B: Prefisso Plugin Automatico

### pluginConfig.json5 (Invariato)

```json5
{
  "adminSections": [
    "gallery",      // Plugin specifica solo nome locale
    "upload"
  ]
}
```

### /core/admin/adminConfig.json5

```json5
{
  "sections": {
    // ⚠️ SectionId include prefisso plugin
    "adminMedia_gallery": {           // ✅ Univocità garantita
      "type": "plugin",
      "plugin": "adminMedia",
      "label": "Galleria Media",
      "icon": "🖼️"
    },
    "adminMedia_upload": {
      "type": "plugin",
      "plugin": "adminMedia",
      "label": "Carica Media",
      "icon": "📤"
    }
  }
}
```

### SymlinkManager.installPluginSection() - Modificato

```javascript
// ✅ Aggiunge prefisso automaticamente
for (const localSectionId of adminSections) {
  const prefixedSectionId = `${pluginName}_${localSectionId}`  // adminMedia_gallery

  const sourcePath = path.join(pluginPath, localSectionId)     // plugins/adminMedia/gallery/
  const symlinkPath = path.join(adminWebPages, prefixedSectionId)  // webPages/adminMedia_gallery

  fs.symlinkSync(sourcePath, symlinkPath, 'dir')
}
```

### URL Generate

```
⚠️ Breaking change:
/admin/adminMedia_gallery/index.ejs        (era: /admin/gallery/index.ejs)
/admin/adminMedia_gallery/imageView.ejs?id=123
/admin/adminMedia_upload/index.ejs
```

### Risultato

```
✅ Zero conflitti tra plugin
✅ Identificazione immediata plugin
❌ URL più lunghi e verbosi
❌ Breaking change per URL esistenti
```

---

## 🟣 ALTERNATIVA C: Namespace Gerarchico

### pluginConfig.json5

```json5
{
  "active": 1,

  "adminNamespace": {
    "label": "Gestione Media",         // ✅ Label categoria
    "icon": "🎬",
    "menuWeight": 100,
    "sections": [
      {
        "id": "gallery",
        "label": "Galleria",           // ✅ Label sotto-sezione
        "icon": "🖼️",
        "description": "Visualizza immagini"
      },
      {
        "id": "upload",
        "label": "Carica",
        "icon": "📤",
        "description": "Upload bulk"
      }
    ]
  }
}
```

### /core/admin/adminConfig.json5 (Molto ridotto)

```json5
{
  // ✅ Nessuna configurazione necessaria (tutto auto-registrato)
  "sections": {},
  "menuOrder": []
}
```

### URL Generate (Namespace-based)

```
⚠️ Breaking change totale:
/admin/plugin/adminMedia/gallery/index.ejs
/admin/plugin/adminMedia/gallery/imageView.ejs?id=123
/admin/plugin/adminMedia/upload/index.ejs
```

### Menu Generato (Gerarchico)

```
📋 Menu Admin:
  👥 Gestione Utenti
     ├─ 👤 Utenti        (/admin/plugin/adminUsers/usersManagment/)
     └─ 🏷️  Ruoli        (/admin/plugin/adminUsers/rolesManagment/)
  🎬 Gestione Media
     ├─ 🖼️  Galleria     (/admin/plugin/adminMedia/gallery/)
     └─ 📤 Carica       (/admin/plugin/adminMedia/upload/)
  ⚙️  Impostazioni
```

### Routing (Nuovo Pattern)

```javascript
// AdminSystem router setup
router.get('/admin/plugin/:pluginName/:sectionId/:page', async (ctx) => {
  const { pluginName, sectionId, page } = ctx.params

  const plugin = pluginSys.getPlugin(pluginName)
  const templatePath = path.join(plugin.pathPluginFolder, sectionId, page)

  await ctx.render(templatePath, passData)
})
```

### Risultato

```
✅ Organizzazione logica eccellente
✅ Menu gerarchico (sottomenu)
✅ Scalabilità massima
❌ Breaking change totale
❌ Refactoring significativo
```

---

## 🔴 ALTERNATIVA D: Plugin-Side Rendering (PSR)

### main.js - Nuovo Hook

```javascript
// plugins/adminMedia/main.js
module.exports = {
  async loadPlugin(pluginSys, pathPluginFolder) {
    this.pathPluginFolder = pathPluginFolder
  },

  // ✅ Nuovo hook: getAdminRoutes
  getAdminRoutes(router, pluginSys, pathPluginFolder) {
    return [
      {
        method: 'get',
        path: '/admin/media/gallery',        // ✅ Custom routing completo
        template: 'gallery/index.ejs',
        menuLabel: 'Galleria Media',
        menuIcon: '🖼️',
        menuWeight: 100,
        showInMenu: true
      },
      {
        method: 'get',
        path: '/admin/media/gallery/view',   // ✅ Sotto-route custom
        template: 'gallery/imageView.ejs',
        showInMenu: false                    // Non mostrare nel menu
      },
      {
        method: 'post',
        path: '/admin/media/gallery/edit',   // ✅ POST route
        handler: async (ctx) => {
          // Custom logic
          const imageId = ctx.request.body.id
          // ... save ...
          ctx.redirect('/admin/media/gallery')
        },
        showInMenu: false
      },
      {
        method: 'get',
        path: '/admin/media/upload',
        template: 'upload/index.ejs',
        menuLabel: 'Carica Media',
        menuIcon: '📤',
        menuWeight: 110,
        showInMenu: true
      }
    ]
  }
}
```

### AdminSystem - Route Registration

```javascript
// AdminSystem.initialize()
for (const plugin of adminPlugins) {
  if (!plugin.getAdminRoutes) continue

  const routes = plugin.getAdminRoutes(router, pluginSys, plugin.pathPluginFolder)

  for (const route of routes) {
    const handler = route.handler || (async (ctx) => {
      // Default: render template
      const templatePath = path.join(plugin.pathPluginFolder, route.template)
      await ctx.render(templatePath, passData)
    })

    router[route.method](route.path, handler)

    // Aggiungi al menu se showInMenu
    if (route.showInMenu) {
      menuItems.push({
        label: route.menuLabel,
        icon: route.menuIcon,
        url: route.path,
        weight: route.menuWeight
      })
    }
  }
}
```

### /core/admin/adminConfig.json5 (Non necessario)

```json5
{
  // ✅ Tutto auto-registrato da plugin
  "sections": {},   // Vuoto!
  "menuOrder": []   // Auto-generato da menuWeight
}
```

### Risultato

```
✅ Flessibilità massima (route custom, POST, GET, etc)
✅ Nessun symlink (semplifica deploy)
✅ Plugin completamente autonomi
❌ Breaking change totale
❌ Abbandona pattern "static server"
❌ Più complesso per plugin developer
```

---

## 🟠 ALTERNATIVA E: Incrementale (Raccomandazione 3)

### pluginConfig.json5 (Hybrid - Backward Compatible)

```json5
{
  "active": 1,

  "adminSections": [
    // ✅ Supporta ENTRAMBI formati:

    // Formato vecchio (string) - backward compatible
    "legacySection",

    // Formato nuovo (object) - con metadata
    {
      "id": "gallery",
      "label": "Galleria Media",
      "icon": "🖼️",
      "description": "Visualizza e gestisci immagini",
      "menuWeight": 100,
      "enabled": true,
      "pages": {                           // ✅ Convenzione sotto-pagine
        "index": "Lista immagini",
        "view": "Dettaglio immagine",
        "upsert": "Carica/Modifica",
        "delete": "Elimina immagine"
      }
    },
    {
      "id": "upload",
      "label": "Carica Media",
      "icon": "📤",
      "menuWeight": 110
    }
  ]
}
```

### /core/admin/adminConfig.json5 (Override Opzionale)

```json5
{
  "sections": {
    // ✅ Opzionale: solo se vuoi override
    "gallery": {
      "enabled": false,      // Disabilita sezione
      "menuWeight": 200      // Cambia posizione menu
    }
    // "upload" non specificato → usa metadata da plugin
  },

  // ✅ menuOrder opzionale
  "menuOrder": []  // Se vuoto, usa menuWeight
}
```

### SymlinkManager - Backward Compatible

```javascript
installPluginSection(plugin) {
  const adminSections = plugin.pluginConfig?.adminSections || []

  for (const section of adminSections) {
    let sectionId, metadata

    // ✅ Supporta entrambi formati
    if (typeof section === 'string') {
      // Formato vecchio: "gallery"
      sectionId = section
      metadata = null
    } else {
      // Formato nuovo: { id: "gallery", label: "...", ... }
      sectionId = section.id
      metadata = section
    }

    // Salva metadata sul plugin
    if (!plugin.adminSectionsMetadata) {
      plugin.adminSectionsMetadata = {}
    }
    plugin.adminSectionsMetadata[sectionId] = metadata

    // Crea symlink come prima
    const sourcePath = path.join(plugin.pathPluginFolder, sectionId)
    const symlinkPath = path.join(this.adminWebPagesPath, sectionId)
    fs.symlinkSync(sourcePath, symlinkPath, 'dir')
  }
}
```

### AdminSystem.getMenuSections() - Metadata Merge

```javascript
getMenuSections() {
  const sections = []
  const config = this.configManager.getConfig()

  for (const plugin of this.pluginSys.getAllPlugins()) {
    if (!plugin.pluginName.startsWith('admin')) continue
    if (!plugin.adminSectionsMetadata) continue

    for (const [sectionId, pluginMetadata] of Object.entries(plugin.adminSectionsMetadata)) {
      const centralMetadata = config.sections[sectionId]

      // ✅ Merge: central override > plugin metadata > defaults
      const effectiveMetadata = {
        label: centralMetadata?.label || pluginMetadata?.label || sectionId,
        icon: centralMetadata?.icon || pluginMetadata?.icon || '',
        description: centralMetadata?.description || pluginMetadata?.description || '',
        enabled: centralMetadata?.enabled ?? pluginMetadata?.enabled ?? true,
        menuWeight: centralMetadata?.menuWeight ?? pluginMetadata?.menuWeight ?? 999
      }

      if (!effectiveMetadata.enabled) continue

      sections.push({
        id: sectionId,
        ...effectiveMetadata,
        url: `/${this.adminPrefix}/${sectionId}/index.ejs`,
        type: 'plugin',
        plugin: plugin.pluginName
      })
    }
  }

  // ✅ Ordina per menuWeight (o usa menuOrder se specificato)
  if (config.menuOrder && config.menuOrder.length > 0) {
    // Usa ordine manuale
    sections.sort((a, b) => {
      const indexA = config.menuOrder.indexOf(a.id)
      const indexB = config.menuOrder.indexOf(b.id)
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB)
    })
  } else {
    // Usa menuWeight automatico
    sections.sort((a, b) => a.menuWeight - b.menuWeight)
  }

  return sections
}
```

### Conflict Detection (Auto-Prefix se Necessario)

```javascript
// Opzione: rilevamento conflitti con auto-prefix
validateSectionIds() {
  const sectionMap = new Map()

  for (const plugin of this.pluginSys.getAllPlugins()) {
    if (!plugin.pluginName.startsWith('admin')) continue

    for (const [sectionId, metadata] of Object.entries(plugin.adminSectionsMetadata || {})) {
      if (sectionMap.has(sectionId)) {
        const conflictPlugin = sectionMap.get(sectionId)

        // Opzione A: Errore
        throw new Error(
          `❌ Section ID conflict: "${sectionId}"\n` +
          `  Plugin 1: ${conflictPlugin}\n` +
          `  Plugin 2: ${plugin.pluginName}\n` +
          `Solution: Rename section or enable auto-prefix`
        )

        // Opzione B: Auto-prefix (se configurato)
        if (config.autoPrefix === true) {
          const newSectionId = `${plugin.pluginName}_${sectionId}`
          console.warn(
            `⚠️  Section ID conflict detected: "${sectionId}"\n` +
            `  Auto-prefixed to: "${newSectionId}"`
          )
          // Rinomina e ricrea symlink con prefisso
          this.symlinkManager.renameSection(plugin, sectionId, newSectionId)
        }
      }

      sectionMap.set(sectionId, plugin.pluginName)
    }
  }
}
```

### Convenzione Sotto-Pagine (Standard Naming)

```
gallery/
├── index.ejs              # Lista (GET /admin/gallery/)
├── view.ejs               # Dettaglio (GET /admin/gallery/view.ejs?id=123)
├── upsert.ejs             # Create/Update (GET/POST /admin/gallery/upsert.ejs?id=123)
├── delete.ejs             # Delete confirm (GET /admin/gallery/delete.ejs?id=123)
└── custom.ejs             # Pagine custom

✅ Standard consigliato (soft convention)
⚠️  Non obbligatorio (plugin può usare naming custom)
```

### Risultato

```
✅ Backward compatible (supporta vecchio formato)
✅ Metadata nel plugin (self-contained)
✅ Override centrali opzionali
✅ Auto-ordering con menuWeight
✅ Conflict detection opzionale
✅ Convenzioni sotto-pagine chiare
✅ Nessun breaking change
✅ Migrazione graduale possibile
⚠️  Logica più complessa (merge metadata)
```

---

## 📊 Confronto Visivo

### Plugin Structure

```
┌─────────────────────────────────────────────────────────────┐
│ ATTUALE (v1.5.0)                                            │
├─────────────────────────────────────────────────────────────┤
│ Plugin: adminMedia/                                         │
│   ├─ pluginConfig.json5 → adminSections: ["gallery", ...]  │
│   ├─ gallery/ → files EJS                                   │
│   └─ upload/ → files EJS                                    │
│                                                              │
│ Central: /core/admin/adminConfig.json5                      │
│   ├─ sections.gallery → { label, icon, ... }   ❌ DUP!      │
│   └─ menuOrder: ["gallery", "upload", ...]     ❌ MANUAL    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ALTERNATIVE A (Metadata Plugin)                             │
├─────────────────────────────────────────────────────────────┤
│ Plugin: adminMedia/                                         │
│   ├─ pluginConfig.json5 → adminSections: [                 │
│   │    { id, label, icon, menuWeight } ✅ METADATA         │
│   │  ]                                                      │
│   ├─ gallery/                                               │
│   └─ upload/                                                │
│                                                              │
│ Central: /core/admin/adminConfig.json5                      │
│   └─ sections: {} (opzionale, solo override) ✅ CLEAN       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ALTERNATIVE B (Prefisso Auto)                               │
├─────────────────────────────────────────────────────────────┤
│ Plugin: adminMedia/                                         │
│   ├─ pluginConfig.json5 → adminSections: ["gallery"]       │
│   ├─ gallery/ (nome locale)                                 │
│   └─ upload/ (nome locale)                                  │
│                                                              │
│ Symlink: webPages/adminMedia_gallery ✅ UNIVOCO             │
│ URL: /admin/adminMedia_gallery/ ⚠️  VERBOSE                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ALTERNATIVE C (Namespace)                                   │
├─────────────────────────────────────────────────────────────┤
│ Plugin: adminMedia/                                         │
│   └─ pluginConfig.json5 → adminNamespace: {                │
│        label: "Media",                                      │
│        sections: [{ id, label, ... }]                       │
│      }                                                      │
│                                                              │
│ URL: /admin/plugin/adminMedia/gallery/ ✅ HIERARCHICAL      │
│ Menu: Media → Galleria ✅ NESTED                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ALTERNATIVE D (PSR)                                         │
├─────────────────────────────────────────────────────────────┤
│ Plugin: adminMedia/                                         │
│   └─ main.js → getAdminRoutes() {                          │
│        return [{                                            │
│          path: '/admin/media/gallery', ✅ CUSTOM           │
│          template: 'gallery/index.ejs',                     │
│          menuLabel: '...', menuIcon: '...'                  │
│        }]                                                   │
│      }                                                      │
│                                                              │
│ No Symlink! ✅ DIRECT ROUTING                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ALTERNATIVE E (Incrementale)                                │
├─────────────────────────────────────────────────────────────┤
│ Plugin: adminMedia/                                         │
│   ├─ pluginConfig.json5 → adminSections: [                 │
│   │    "old",  ✅ BACKWARD COMPAT                          │
│   │    { id, label, menuWeight, pages: {...} } ✅ NEW      │
│   │  ]                                                      │
│   ├─ gallery/                                               │
│   └─ upload/                                                │
│                                                              │
│ Central: /core/admin/adminConfig.json5                      │
│   └─ sections: {} (auto-register) ✅ OPTIONAL OVERRIDE      │
│                                                              │
│ ✅ Merge Logic: central > plugin > defaults                 │
│ ✅ Conflict Detection + Auto-Prefix (opzionale)             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎯 Raccomandazione Finale Visuale

```
┌───────────────────────────────────────────────────────────────┐
│                                                                │
│  🏆 HYBRID BEST-OF-BOTH (Alt E + Nomenclatura Opzionale)      │
│                                                                │
├───────────────────────────────────────────────────────────────┤
│                                                                │
│  📁 Plugin Structure:                                          │
│     plugins/adminMedia/                                        │
│       ├─ pluginConfig.json5                                    │
│       │    {                                                   │
│       │      "adminSections": [                                │
│       │        {                                               │
│       │          "id": "gallery",                              │
│       │          "label": "Galleria Media",                    │
│       │          "icon": "🖼️",                                 │
│       │          "menuWeight": 100,                            │
│       │          "pages": {                                    │
│       │            "index": "Lista",                           │
│       │            "view": "Dettaglio",                        │
│       │            "upsert": "Carica/Modifica"                 │
│       │          }                                             │
│       │        }                                               │
│       │      ]                                                 │
│       │    }                                                   │
│       └─ gallery/                                              │
│            ├─ index.ejs                                        │
│            ├─ view.ejs                                         │
│            └─ upsert.ejs                                       │
│                                                                │
│  ⚙️  Central Config (OPTIONAL):                                │
│     /core/admin/adminConfig.json5                             │
│       {                                                        │
│         "sections": {                                          │
│           "gallery": {                                         │
│             "enabled": false  // Override solo se necessario   │
│           }                                                    │
│         },                                                     │
│         "menuOrder": [],  // Auto da menuWeight               │
│         "autoPrefix": true  // Risolve conflitti automatico   │
│       }                                                        │
│                                                                │
│  🔗 Symlink:                                                   │
│     webPages/gallery → plugins/adminMedia/gallery/            │
│     (o webPages/adminMedia_gallery se conflitto rilevato)     │
│                                                                │
│  🌐 URL:                                                       │
│     /admin/gallery/index.ejs                                  │
│     /admin/gallery/view.ejs?id=123                            │
│     (o /admin/adminMedia_gallery/... se auto-prefix)          │
│                                                                │
│  ✅ Benefits:                                                  │
│     • Backward compatible ✅                                   │
│     • Plugin self-contained ✅                                 │
│     • Central override optional ✅                             │
│     • Auto-ordering ✅                                         │
│     • Conflict detection ✅                                    │
│     • Convenzioni chiare ✅                                    │
│     • Migrazione graduale ✅                                   │
│                                                                │
└───────────────────────────────────────────────────────────────┘
```

---

**Conclusione:** L'alternativa **E (Incrementale)** con nomenclatura **opzionale** offre il miglior compromesso tra:
- ✅ **Nessun breaking change** (backward compatible)
- ✅ **Plugin self-contained** (metadata nel plugin)
- ✅ **Flessibilità** (override centrali opzionali)
- ✅ **Prevenzione conflitti** (auto-prefix opzionale)
- ✅ **Developer-friendly** (convenzioni chiare ma non obbligatorie)

---

**Autore:** AI Assistant
**Data:** 2026-01-03
**Versione:** 1.0.0
