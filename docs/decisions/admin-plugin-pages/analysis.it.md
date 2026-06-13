<!-- ital8doc v1-1 · tipo: reference · lang: it · ref -->
# Analisi: Standard Admin Plugin Pages

## 📋 Situazione Attuale

### Architettura Esistente

**Sistema Admin Attuale (v1.5.0):**
- ✅ Convenzione naming: plugin con nome che inizia con `admin` sono automaticamente plugin admin
- ✅ Sezioni dichiarate in `pluginConfig.json5` tramite array `adminSections` (stringhe)
- ✅ Metadata UI (label, icon, description) centralizzati in `/core/admin/adminConfig.json5`
- ✅ Symlink automatici: `core/admin/webPages/{sectionId} → plugins/{pluginName}/adminWebSections/{sectionId}/`
- ✅ Supporto multi-sezione: un plugin può fornire più sezioni admin

**Esempio Plugin Admin Corrente (adminUsers):**

```
plugins/adminUsers/
├── main.js
├── pluginConfig.json5          ← adminSections: ["usersManagment", "rolesManagment"]
├── pluginDescription.json5
├── adminWebSections/           ← Admin sections container directory
│   ├── usersManagment/         ← Sezione 1 (servita via symlink)
│   │   ├── index.ejs
│   │   ├── userView.ejs
│   │   ├── userUpsert.ejs
│   │   └── userDelete.ejs
│   └── rolesManagment/         ← Sezione 2 (servita via symlink)
│       └── index.ejs
├── userAccount.json5
├── userRole.json5
├── userManagement.js
└── roleManagement.js
```

**Configurazione Centrale (`/core/admin/adminConfig.json5`):**

```json5
{
  "sections": {
    "usersManagment": {
      "type": "plugin",
      "plugin": "adminUsers",
      "enabled": true,
      "required": true,
      "label": "Gestione Utenti",
      "icon": "👥",
      "description": "Gestione utenti e permessi del sistema"
    }
  },
  "menuOrder": ["usersManagment", "rolesManagment", ...]
}
```

---

## 🔍 Analisi Problemi/Limitazioni

### 1. **Configurazione Duplicata (DRY Violation)**

**Problema:** Le sezioni devono essere dichiarate in DUE posti:
1. `pluginConfig.json5` → `adminSections: ["usersManagment"]`
2. `/core/admin/adminConfig.json5` → `sections.usersManagment: { ... }`

**Conseguenze:**
- ❌ Facile dimenticare di aggiungere metadata UI
- ❌ Manutenzione: modifiche in due file
- ❌ Disallineamento: sezione dichiarata ma senza metadata UI

### 2. **Gestione Menu Centralizzata vs Distribuita**

**Problema:** `menuOrder` è globale in `adminConfig.json5`

**Conseguenze:**
- ❌ Ogni nuovo plugin richiede modifica manuale file centrale
- ❌ Non scale-friendly: con molti plugin diventa difficile gestire
- ❌ Plugin non può specificare posizione preferita nel menu

### 3. **Identificativi di Sezione Non Prefissati**

**Problema:** `sectionId` non contiene riferimento al plugin

**Esempio Attuale:**
```
sectionId: "usersManagment"  (plugin: adminUsers)
```

**Rischio Conflitti:**
- ❌ Due plugin potrebbero voler usare stesso `sectionId`
- ❌ Non immediatamente chiaro quale plugin gestisce quale sezione
- ❌ Conflitti symlink se due plugin usano stesso nome

### 4. **Metadata UI Centralizzato**

**Problema:** Label/icon/description sono in file centrale, non nel plugin

**Conseguenze:**
- ❌ Plugin non è self-contained
- ❌ Distribuzione plugin richiede documentazione separata per UI
- ❌ Difficile portabilità: serve setup manuale in `adminConfig.json5`

### 5. **Mancanza di Sotto-Pagine Strutturate**

**Problema:** Non c'è convenzione per sotto-pagine di una sezione

**Esempio Attuale:**
```
usersManagment/
├── index.ejs
├── userView.ejs        ← Non c'è standard per routing/naming
├── userUpsert.ejs
└── userDelete.ejs
```

**Conseguenze:**
- ❌ Naming arbitrario
- ❌ Routing non standardizzato
- ❌ Difficile generare breadcrumb/navigazione automatica

---

## 💡 Alternative Architetturali

### **Alternativa A: Configurazione Ibrida con Metadata nel Plugin**

**Concetto:** Metadata UI (label, icon, description) definiti nel plugin, registrazione centrale opzionale.

**Struttura Plugin:**

```json5
// plugins/adminUsers/pluginConfig.json5
{
  "adminSections": [
    {
      "id": "usersManagment",
      "label": "Gestione Utenti",
      "icon": "👥",
      "description": "Gestione utenti e permessi",
      "menuWeight": 10,           // Posizione preferita nel menu (opzionale)
      "enabled": true             // Abilitazione default
    },
    {
      "id": "rolesManagment",
      "label": "Gestione Ruoli",
      "icon": "🏷️",
      "description": "Gestione ruoli custom",
      "menuWeight": 20,
      "enabled": true
    }
  ]
}
```

**Configurazione Centrale:**

```json5
// /core/admin/adminConfig.json5
{
  "sections": {
    // Override opzionali (se non specificati, usa metadata da plugin)
    "usersManagment": {
      "enabled": false,        // Disabilita sezione
      "menuWeight": 100        // Override posizione menu
    }
  },

  // menuOrder diventa opzionale (usa menuWeight se non specificato)
  "menuOrder": ["custom", "order", "if", "needed"]
}
```

**✅ Pro:**
- Plugin self-contained (tutti metadata nel plugin)
- Riduce duplicazione
- Override centrali opzionali
- Facile distribuzione plugin

**❌ Contro:**
- Logica più complessa (merge metadata plugin + override centrali)
- Possibile confusione: "dove è definito cosa?"

---

### **Alternativa B: Prefisso Plugin Automatico per Section ID**

**Concetto:** `sectionId` include automaticamente nome plugin come prefisso.

**Naming Convention:**
```
Formato: {pluginName}_{sectionName}
Esempio: adminUsers_usersManagment
         adminUsers_rolesManagment
         adminMedia_gallery
```

**Struttura Plugin:**

```json5
// plugins/adminUsers/pluginConfig.json5
{
  "adminSections": [
    "usersManagment",      // Diventa automaticamente: adminUsers_usersManagment
    "rolesManagment"       // Diventa automaticamente: adminUsers_rolesManagment
  ]
}
```

**Implementazione:**
- SymlinkManager aggiunge prefisso automaticamente
- URL: `/admin/adminUsers_usersManagment/index.ejs`
- Symlink: `webPages/adminUsers_usersManagment → plugins/adminUsers/adminWebSections/usersManagment/`

**✅ Pro:**
- Zero conflitti tra plugin
- Identificazione immediata plugin → sezione
- Plugin specifica solo nome locale sezione
- Backward compatible (plugin non cambia struttura)

**❌ Contro:**
- URL più lunghi e verbose
- Naming meno clean esteticamente
- Breaking change per URL esistenti

---

### **Alternativa C: Namespace Gerarchico**

**Concetto:** Sezioni organizzate per namespace plugin in struttura gerarchica.

**URL Structure:**
```
/admin/plugin/{pluginName}/{sectionName}/
Esempi:
  /admin/plugin/adminUsers/usersManagment/
  /admin/plugin/adminUsers/rolesManagment/
  /admin/plugin/adminMedia/gallery/
```

**Menu Structure:**
```
Menu Admin:
  └─ Gestione Utenti
     ├─ Utenti           (adminUsers/usersManagment)
     └─ Ruoli            (adminUsers/rolesManagment)
  └─ Media
     └─ Galleria         (adminMedia/gallery)
```

**Configurazione Plugin:**

```json5
// plugins/adminUsers/pluginConfig.json5
{
  "adminNamespace": {
    "label": "Gestione Utenti",     // Label categoria menu
    "icon": "👥",
    "sections": [
      {
        "id": "usersManagment",
        "label": "Utenti",
        "icon": "👤"
      },
      {
        "id": "rolesManagment",
        "label": "Ruoli",
        "icon": "🏷️"
      }
    ]
  }
}
```

**✅ Pro:**
- Organizzazione logica per plugin
- Menu gerarchico (sottomenu)
- URL chiaro e leggibile
- Scalabile (molti plugin)

**❌ Contro:**
- Cambia radicalmente routing esistente
- Richiede refactoring AdminSystem
- Menu a due livelli (più complesso)
- Breaking change significativo

---

### **Alternativa D: Sistema Plugin-Side Rendering (PSR)**

**Concetto:** Plugin registrano route admin direttamente, senza symlink.

**Architettura:**

```javascript
// plugins/adminUsers/main.js
module.exports = {
  getAdminRoutes(router, pluginSys, pathPluginFolder) {
    return [
      {
        path: '/admin/users/list',
        template: 'usersManagment/index.ejs',
        menuLabel: 'Gestione Utenti',
        menuIcon: '👥',
        menuWeight: 10
      },
      {
        path: '/admin/users/view',
        template: 'usersManagment/userView.ejs',
        showInMenu: false
      }
    ]
  }
}
```

**Workflow:**
1. Plugin dichiara route admin in `getAdminRoutes()`
2. AdminSystem registra route come normali Koa routes
3. Nessun symlink necessario
4. Template renderizzati direttamente da plugin folder

**✅ Pro:**
- Nessun symlink (semplifica deploy)
- Plugin definisce routing completo
- Flessibilità massima (route custom)
- Metadata menu inline con route

**❌ Contro:**
- Breaking change totale
- Abbandona convenzione "static server"
- Richiede riscrittura AdminSystem
- Più complesso per plugin developer

---

### **Alternativa E: Standard Attuale + Convenzioni Aggiuntive**

**Concetto:** Migliorare standard esistente senza breaking changes.

**Aggiunte Proposte:**

#### E.1: **Metadata UI opzionali nel Plugin**

```json5
// plugins/adminUsers/pluginConfig.json5
{
  "adminSections": [
    {
      "id": "usersManagment",
      // Metadata opzionali (fallback se non in adminConfig.json5)
      "label": "Gestione Utenti",
      "icon": "👥",
      "description": "Gestione utenti e permessi"
    }
  ]
}
```

**Logica Merge:**
- Se metadata in `adminConfig.json5` → usa quelli (override)
- Altrimenti → usa metadata da `pluginConfig.json5` (fallback)
- Se mancano entrambi → errore o default

#### E.2: **Auto-Registration delle Sezioni**

```javascript
// AdminSystem.initialize()
// Auto-registra sezioni plugin in adminConfig se non presenti
for (const plugin of adminPlugins) {
  for (const section of plugin.adminSections) {
    if (!adminConfig.sections[section.id]) {
      // Auto-registra con metadata da plugin
      adminConfig.sections[section.id] = {
        type: 'plugin',
        plugin: plugin.pluginName,
        enabled: section.enabled || true,
        label: section.label,
        icon: section.icon,
        description: section.description
      }
    }
  }
}
```

#### E.3: **Convenzione Sotto-Pagine**

**Standard Naming:**
```
{sectionId}/
├── index.ejs                    # Lista/Dashboard
├── view.ejs                     # Visualizza singolo elemento
├── create.ejs / upsert.ejs      # Crea nuovo / Crea o Modifica
├── edit.ejs                     # Modifica esistente
├── delete.ejs                   # Conferma eliminazione
└── {custom}.ejs                 # Pagine custom
```

**Query Parameters Standardizzati:**
```
/admin/usersManagment/index.ejs              # Lista
/admin/usersManagment/view.ejs?id=123        # Dettaglio
/admin/usersManagment/upsert.ejs?id=123      # Modifica
/admin/usersManagment/upsert.ejs             # Crea nuovo
/admin/usersManagment/delete.ejs?id=123      # Elimina
```

#### E.4: **menuWeight nel Plugin**

```json5
// plugins/adminUsers/pluginConfig.json5
{
  "adminSections": [
    {
      "id": "usersManagment",
      "menuWeight": 10    // Posizione preferita menu
    }
  ]
}
```

**Generazione `menuOrder` automatica:**
- Se non specificato in `adminConfig.json5`
- Ordina sezioni per `menuWeight` (crescente)
- Sezioni senza weight vanno alla fine

**✅ Pro:**
- Nessun breaking change
- Incrementale (aggiunte graduali)
- Backward compatible
- Riduce duplicazione

**❌ Contro:**
- Non risolve tutti problemi architetturali
- Ancora necessario configurazione centrale (anche se ridotta)
- Non previene conflitti sectionId

---

## 🏷️ Nomenclatura e Convenzioni

### **Opzione N1: Prefisso Plugin Esplicito**

**Formato:** `{pluginName}_{sectionName}`

**Esempi:**
```
adminUsers_usersManagment
adminUsers_rolesManagment
adminMedia_gallery
adminMailer_templates
```

**Implementazione:**
- Plugin dichiara solo parte locale: `"usersManagment"`
- Sistema aggiunge prefisso automaticamente

**✅ Vantaggi:**
- Univocità garantita
- Tracciabilità plugin → sezione

**❌ Svantaggi:**
- URL verbosi
- Estetica meno pulita

---

### **Opzione N2: Separatore Slash (Namespace)**

**Formato:** `{pluginName}/{sectionName}`

**Esempi:**
```
adminUsers/usersManagment
adminUsers/rolesManagment
adminMedia/gallery
```

**URL:**
```
/admin/adminUsers/usersManagment/
/admin/adminUsers/rolesManagment/
```

**✅ Vantaggi:**
- Leggibilità migliore
- Struttura gerarchica chiara
- Standard REST-like

**❌ Svantaggi:**
- Cambia routing (breaking change)
- Complica gestione symlink

---

### **Opzione N3: Prefisso Abbreviato**

**Formato:** `{abbreviazione}_{sectionName}`

**Esempi:**
```
au_usersManagment      (adminUsers)
au_rolesManagment
am_gallery             (adminMedia)
```

**Mapping:**
```json5
// pluginDescription.json5
{
  "name": "adminUsers",
  "abbreviation": "au"    // 2-3 caratteri univoci
}
```

**✅ Vantaggi:**
- URL più corti
- Univocità garantita

**❌ Svantaggi:**
- Meno intuitivo
- Richiede lookup abbreviazione → plugin
- Possibili conflitti abbreviazioni

---

### **Opzione N4: Mantenere Standard Attuale (Locale)**

**Formato:** `{sectionName}` (senza prefisso)

**Esempi:**
```
usersManagment
rolesManagment
gallery
```

**Gestione Conflitti:**
- Errore a runtime se due plugin usano stesso ID
- Documentazione: plugin developer responsabile univocità

**✅ Vantaggi:**
- URL puliti e corti
- Nessun breaking change
- Semplicità

**❌ Svantaggi:**
- Rischio conflitti
- Necessita namespace convention nella community

---

## 📊 Comparazione Alternative

| Aspetto | Alt A (Metadata Plugin) | Alt B (Prefisso Auto) | Alt C (Namespace) | Alt D (PSR) | Alt E (Incrementale) |
|---------|------------------------|----------------------|------------------|-------------|---------------------|
| **Breaking Change** | Minimo | Medio | Alto | Totale | Nessuno |
| **Complessità Implementazione** | Media | Bassa | Alta | Molto Alta | Bassa |
| **Plugin Self-Contained** | ✅ Alto | ⚠️ Medio | ✅ Alto | ✅ Molto Alto | ⚠️ Medio |
| **Rischio Conflitti** | ✅ Basso | ✅ Zero | ✅ Zero | ✅ Zero | ❌ Medio-Alto |
| **URL Leggibilità** | ✅ Buona | ⚠️ Verbosa | ✅ Ottima | ✅ Custom | ✅ Buona |
| **Scalabilità** | ✅ Buona | ✅ Buona | ✅ Ottima | ✅ Ottima | ⚠️ Media |
| **Backward Compatible** | ⚠️ Parziale | ❌ No | ❌ No | ❌ No | ✅ Sì |
| **Effort Developer** | Medio | Basso | Alto | Alto | Basso |

---

## 🎯 Raccomandazioni Finali

### **Raccomandazione 1: Approccio Incrementale (Alt E + Nomenclatura N1)**

**Combinazione Suggerita:**
1. **Alternative E** (incrementale) per non rompere esistente
2. **Nomenclatura N1** (prefisso plugin) per univocità
3. **Migrazione graduale** verso metadata nel plugin

**Implementazione Fase 1:**
- Metadata UI opzionali in `pluginConfig.json5`
- Prefisso automatico `{plugin}_{section}` per nuove sezioni
- Auto-registration sezioni in adminConfig
- Backward compatibility per sezioni esistenti

**Implementazione Fase 2:**
- Deprecare configurazione manuale in `adminConfig.json5`
- Tool migrazione automatica
- Convention sotto-pagine standardizzate

---

### **Raccomandazione 2: Approccio Namespace (Alt C + Nomenclatura N2)**

**Se si accetta breaking change:**

1. **Alternative C** (namespace gerarchico)
2. **Nomenclatura N2** (slash separator)
3. **Menu multi-livello**

**Pro Strategico:**
- Scalabilità eccellente
- Standard chiaro e moderno
- Plugin completamente autonomi

**Contro Strategico:**
- Refactoring significativo
- Breaking change per tutti plugin admin esistenti
- Richiede tempo implementazione

---

### **Raccomandazione 3: Hybrid Best-of-Both**

**Combinazione Pragmatica:**

- **Base:** Alternative E (incrementale)
- **Nomenclatura:** Opzionale N1 (prefisso) solo se conflitto rilevato
- **Metadata:** Alternative A (plugin first, central override)
- **Convenzioni:** Sotto-pagine standardizzate (E.3)

**Esempio Concreto:**

```json5
// plugins/adminMedia/pluginConfig.json5
{
  "adminSections": [
    {
      "id": "gallery",                    // Locale (no prefisso)
      "label": "Galleria Media",          // Metadata inline
      "icon": "🖼️",
      "description": "Gestione immagini e video",
      "menuWeight": 50,                   // Posizione preferita
      "pages": {                          // Convenzione sotto-pagine
        "index": "Lista media",
        "view": "Dettaglio media",
        "upsert": "Carica/Modifica",
        "delete": "Elimina media"
      }
    }
  ]
}
```

```json5
// /core/admin/adminConfig.json5
{
  "sections": {
    // Override opzionale (se vuoi cambiare label/disabilitare/etc)
    "gallery": {
      "enabled": false    // Esempio: disabilita sezione
    }
  },

  // menuOrder opzionale (usa menuWeight se non specificato)
  "menuOrder": ["custom", "order"]
}
```

**Conflict Resolution:**
```javascript
// Se due plugin usano "gallery":
// Opzione A: Errore esplicito
throw new Error(`Section "gallery" conflict: adminMedia vs adminGallery`)

// Opzione B: Auto-prefisso
// adminMedia → "gallery" diventa "adminMedia_gallery"
// adminGallery → "gallery" diventa "adminGallery_gallery"
```

---

## 🔄 Migration Path

### **Scenario: Migrazione da Attuale a Hybrid (Raccomandazione 3)**

**Step 1: Backward Compatibility Layer**
- SymlinkManager supporta ENTRAMBI:
  - Vecchio: `adminSections: ["usersManagment"]` (array stringhe)
  - Nuovo: `adminSections: [{ id: "...", label: "...", ... }]` (array oggetti)

**Step 2: Metadata Merge Logic**
```javascript
// AdminSystem.getMenuSections()
function getEffectiveMetadata(sectionId, pluginMetadata, centralMetadata) {
  // Priority: central > plugin > defaults
  return {
    label: centralMetadata?.label || pluginMetadata?.label || sectionId,
    icon: centralMetadata?.icon || pluginMetadata?.icon || '',
    enabled: centralMetadata?.enabled ?? pluginMetadata?.enabled ?? true,
    // ...
  }
}
```

**Step 3: Auto-Registration**
```javascript
// Se sezione non in adminConfig.json5, registra automaticamente
if (!adminConfig.sections[sectionId]) {
  console.log(`Auto-registering section "${sectionId}" from plugin "${pluginName}"`)
  adminConfig.sections[sectionId] = {
    type: 'plugin',
    plugin: pluginName,
    ...pluginMetadata
  }
}
```

**Step 4: Conflict Detection**
```javascript
// Verifica conflitti sectionId
const sectionMap = new Map()
for (const plugin of adminPlugins) {
  for (const section of plugin.adminSections) {
    if (sectionMap.has(section.id)) {
      const conflictPlugin = sectionMap.get(section.id)
      throw new Error(
        `Section ID conflict: "${section.id}"\n` +
        `  Plugin 1: ${conflictPlugin}\n` +
        `  Plugin 2: ${plugin.pluginName}\n` +
        `  Solution: Use unique section IDs or enable auto-prefix`
      )
    }
    sectionMap.set(section.id, plugin.pluginName)
  }
}
```

**Step 5: Deprecation Warnings**
```javascript
// Se trova sezioni in adminConfig non corrispondenti a plugin
for (const [sectionId, config] of Object.entries(adminConfig.sections)) {
  if (config.type === 'plugin') {
    const plugin = pluginSys.getPlugin(config.plugin)
    if (!plugin) continue

    const hasSection = plugin.adminSections?.some(s =>
      (typeof s === 'string' ? s : s.id) === sectionId
    )

    if (!hasSection) {
      console.warn(
        `⚠️ DEPRECATED: Section "${sectionId}" configured in adminConfig.json5 ` +
        `but not declared in plugin "${config.plugin}". ` +
        `Please add to plugin's adminSections array.`
      )
    }
  }
}
```

---

## 📝 Decisioni da Prendere

Prima di implementare, decidere:

### **D1: Nomenclatura Section ID**
- [ ] **Opzione A:** Locale semplice (`usersManagment`) + conflict detection
- [ ] **Opzione B:** Prefisso automatico (`adminUsers_usersManagment`)
- [ ] **Opzione C:** Namespace slash (`adminUsers/usersManagment`) + routing change
- [ ] **Opzione D:** Ibrido (locale default, prefisso se conflitto)

### **D2: Metadata Location**
- [ ] **Opzione A:** Solo in `adminConfig.json5` (status quo)
- [ ] **Opzione B:** Solo in `pluginConfig.json5` (self-contained)
- [ ] **Opzione C:** Plugin first, central override (hybrid)

### **D3: Menu Ordering**
- [ ] **Opzione A:** `menuOrder` manuale in `adminConfig.json5`
- [ ] **Opzione B:** `menuWeight` automatico in plugin
- [ ] **Opzione C:** Ibrido (menuWeight default, menuOrder override)

### **D4: Breaking Changes Acceptance**
- [ ] **Opzione A:** Nessun breaking change (solo additive)
- [ ] **Opzione B:** Breaking minori accettabili (URL prefix)
- [ ] **Opzione C:** Refactoring completo OK (namespace)

### **D5: Convenzioni Sotto-Pagine**
- [ ] **Opzione A:** Nessuna convenzione (libertà plugin)
- [ ] **Opzione B:** Convenzione soft (raccomandazione)
- [ ] **Opzione C:** Convenzione strict (validazione)

---

## 🚀 Next Steps

1. **Review questo documento** con stakeholder
2. **Decidere** su D1-D5
3. **Creare spec tecnica** dettagliata per implementazione
4. **Implementare** in branch separato
5. **Testare** con plugin esistenti
6. **Migrare** plugin uno per uno
7. **Documentare** in CLAUDE.md

---

**Autore:** AI Assistant
**Data:** 2026-01-03
**Versione Analisi:** 1.0.0
**Codice Base:** ital8cms v0.0.1-alpha.0
