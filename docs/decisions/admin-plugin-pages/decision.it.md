<!-- ital8doc v1-1 · tipo: decision · lang: it · ref -->
# Decision Summary: Admin Plugin Pages Standard

**Versione:** 1.0.0
**Data:** 2026-01-03
**Decisione Richiesta:** Standard per pagine admin nei plugin

---

## 📝 Executive Summary

Attualmente (v1.5.0), i plugin admin devono dichiarare le sezioni in **DUE posti**:
1. `pluginConfig.json5` → `adminSections` array
2. `/core/admin/adminConfig.json5` → metadata UI (label, icon, description)

**Problemi Principali:**
- ❌ Duplicazione configurazione (violazione DRY)
- ❌ Plugin non self-contained (richiede setup manuale centrale)
- ❌ Rischio conflitti sectionId (nessun prefisso plugin)
- ❌ Menu order manuale (non scalabile)

**Documentazione Completa:**
- 📄 [`analysis.it.md`](./analysis.it.md) - Analisi dettagliata alternative
- 📄 [`examples.it.md`](./examples.it.md) - Esempi pratici e confronti

---

## 🎯 Raccomandazione Principale

### **ALTERNATIVA E: Approccio Incrementale (Hybrid)**

**Cosa Cambia:**
1. ✅ **Metadata UI nel plugin** (opzionale) + override centrale (opzionale)
2. ✅ **menuWeight automatico** per ordinamento menu
3. ✅ **Conflict detection** + auto-prefix opzionale
4. ✅ **Convenzioni sotto-pagine** standardizzate (soft, non obbligatorie)
5. ✅ **Backward compatible** (supporta vecchio formato)

**Esempio Pratico:**

```json5
// plugins/adminMedia/pluginConfig.json5
{
  "adminSections": [
    {
      "id": "gallery",
      "label": "Galleria Media",          // Metadata inline
      "icon": "🖼️",
      "description": "Gestione immagini",
      "menuWeight": 100,                  // Posizione menu
      "pages": {                          // Convenzione sotto-pagine
        "index": "Lista",
        "view": "Dettaglio",
        "upsert": "Carica/Modifica"
      }
    }
  ]
}
```

```json5
// /core/admin/adminConfig.json5 (OPZIONALE, solo override)
{
  "sections": {
    "gallery": {
      "enabled": false    // Override: disabilita
    }
  },
  "menuOrder": [],        // Vuoto = usa menuWeight automatico
  "autoPrefix": true      // Risolve conflitti con prefisso auto
}
```

**Benefici:**
- ✅ Nessun breaking change
- ✅ Plugin self-contained
- ✅ Migrazione graduale
- ✅ Zero conflitti (con auto-prefix)

---

## ⚖️ Decisioni da Prendere

### **D1: Nomenclatura Section ID**

| Opzione | Formato | Pro | Contro | Voto |
|---------|---------|-----|--------|------|
| **A** | `usersManagment` (locale) | URL puliti, semplice | Rischio conflitti | 🟡 |
| **B** | `adminUsers_usersManagment` (prefisso auto) | Zero conflitti, tracciabile | URL verbosi, breaking change | 🟢 |
| **C** | `adminUsers/usersManagment` (namespace) | Gerarchico, leggibile | Breaking totale, routing change | 🔴 |
| **D** | Ibrido (A + auto-prefix se conflitto) | Best of both | Logica più complessa | 🟢 |

**Raccomandazione:** **Opzione D** (ibrido con auto-prefix opzionale)

---

### **D2: Metadata Location**

| Opzione | Location | Pro | Contro | Voto |
|---------|----------|-----|--------|------|
| **A** | Solo `adminConfig.json5` | Status quo, chiaro | Plugin non self-contained | 🔴 |
| **B** | Solo `pluginConfig.json5` | Self-contained | Nessun override centrale | 🟡 |
| **C** | Plugin first + central override | Flessibilità massima, self-contained | Logica merge complessa | 🟢 |

**Raccomandazione:** **Opzione C** (hybrid metadata)

---

### **D3: Menu Ordering**

| Opzione | Metodo | Pro | Contro | Voto |
|---------|--------|-----|--------|------|
| **A** | `menuOrder` manuale | Controllo totale | Non scalabile, setup manuale | 🔴 |
| **B** | `menuWeight` automatico | Auto-sorting, scalabile | Meno controllo fine | 🟡 |
| **C** | Ibrido (menuWeight default, menuOrder override) | Flessibilità | Logica più complessa | 🟢 |

**Raccomandazione:** **Opzione C** (ibrido con menuWeight default)

---

### **D4: Breaking Changes**

| Opzione | Approccio | Pro | Contro | Voto |
|---------|-----------|-----|--------|------|
| **A** | Zero breaking (solo additive) | Sicuro, backward compat | Limita miglioramenti | 🟢 |
| **B** | Breaking minori OK (URL prefix) | Miglioramenti significativi | Richiede migrazione | 🟡 |
| **C** | Refactoring completo | Architettura ottimale | Effort alto, breaking totale | 🔴 |

**Raccomandazione:** **Opzione A** (zero breaking, approccio incrementale)

---

### **D5: Convenzioni Sotto-Pagine**

| Opzione | Enforcement | Pro | Contro | Voto |
|---------|-------------|-----|--------|------|
| **A** | Nessuna convenzione | Libertà totale | Inconsistenza, difficile manutenzione | 🔴 |
| **B** | Convenzione soft (raccomandazione) | Guida senza vincoli | Possibile non-compliance | 🟢 |
| **C** | Convenzione strict (validazione) | Consistenza garantita | Rigido, limita creatività | 🟡 |

**Raccomandazione:** **Opzione B** (convenzione soft)

**Convenzione Proposta:**
```
{sectionId}/
├── index.ejs              # Lista/Dashboard
├── view.ejs?id={id}       # Visualizza dettaglio
├── upsert.ejs?id={id}     # Crea nuovo / Modifica esistente
├── delete.ejs?id={id}     # Conferma eliminazione
└── {custom}.ejs           # Pagine custom (libertà)
```

---

## 📋 Checklist Implementazione

### **Fase 1: Core Enhancements (Backward Compatible)**

- [ ] **1.1** Modificare `SymlinkManager` per supportare formato oggetto in `adminSections`
- [ ] **1.2** Implementare logica merge metadata (plugin + central override)
- [ ] **1.3** Auto-registration sezioni in `adminConfig` se non presenti
- [ ] **1.4** Implementare `menuWeight` auto-sorting
- [ ] **1.5** Conflict detection per `sectionId` duplicati

### **Fase 2: Optional Features**

- [ ] **2.1** Implementare auto-prefix opzionale (se `autoPrefix: true`)
- [ ] **2.2** Validazione convenzioni sotto-pagine (soft warning)
- [ ] **2.3** Deprecation warnings per configurazioni manuali
- [ ] **2.4** Tool migrazione automatica (script CLI)

### **Fase 3: Documentation & Testing**

- [ ] **3.1** Aggiornare `CLAUDE.md` con nuovo standard
- [ ] **3.2** Creare esempi in `/plugins/exampleAdminPlugin/`
- [ ] **3.3** Testare con plugin esistenti (`adminUsers`)
- [ ] **3.4** Test conflitti sectionId (auto-prefix)
- [ ] **3.5** Test backward compatibility (vecchio formato)

### **Fase 4: Migration (Graduale)**

- [ ] **4.1** Migrare `adminUsers` al nuovo formato
- [ ] **4.2** Rimuovere metadata duplicati da `adminConfig.json5`
- [ ] **4.3** Testare sistema completo
- [ ] **4.4** Commit e documentazione

---

## 🚦 Decisione Finale Suggerita

```
┌──────────────────────────────────────────────────────────┐
│                                                           │
│  ✅ D1: Nomenclatura → Opzione D (ibrido auto-prefix)     │
│  ✅ D2: Metadata → Opzione C (plugin first + override)    │
│  ✅ D3: Menu → Opzione C (menuWeight + menuOrder optional)│
│  ✅ D4: Breaking → Opzione A (zero breaking)              │
│  ✅ D5: Sotto-Pagine → Opzione B (convenzione soft)       │
│                                                           │
│  🎯 RISULTATO: Alternativa E (Incrementale)               │
│                                                           │
│  Benefici:                                                │
│    • ✅ Backward compatible                               │
│    • ✅ Plugin self-contained                             │
│    • ✅ Flessibilità massima                              │
│    • ✅ Scalabile                                         │
│    • ✅ Developer-friendly                                │
│    • ✅ Zero breaking change                              │
│                                                           │
│  Effort:                                                  │
│    • Implementazione: 🟢 Basso-Medio                      │
│    • Testing: 🟢 Basso                                    │
│    • Migrazione: 🟢 Graduale/Opzionale                    │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

---

## 🔄 Migration Example

### **Prima (v1.5.0):**

```json5
// plugins/adminUsers/pluginConfig.json5
{
  "adminSections": ["usersManagment", "rolesManagment"]
}

// /core/admin/adminConfig.json5
{
  "sections": {
    "usersManagment": {
      "type": "plugin",
      "plugin": "adminUsers",
      "label": "Gestione Utenti",    // ❌ Duplicazione
      "icon": "👥"
    },
    "rolesManagment": {
      "type": "plugin",
      "plugin": "adminUsers",
      "label": "Gestione Ruoli",     // ❌ Duplicazione
      "icon": "🏷️"
    }
  },
  "menuOrder": ["usersManagment", "rolesManagment", "..."]  // ❌ Manuale
}
```

### **Dopo (Nuovo Standard):**

```json5
// plugins/adminUsers/pluginConfig.json5
{
  "adminSections": [
    {
      "id": "usersManagment",
      "label": "Gestione Utenti",        // ✅ Self-contained
      "icon": "👥",
      "description": "Gestione utenti e permessi",
      "menuWeight": 10,                  // ✅ Auto-sorting
      "pages": {
        "index": "Lista utenti",
        "view": "Dettaglio utente",
        "upsert": "Crea/Modifica utente",
        "delete": "Elimina utente"
      }
    },
    {
      "id": "rolesManagment",
      "label": "Gestione Ruoli",
      "icon": "🏷️",
      "menuWeight": 20
    }
  ]
}

// /core/admin/adminConfig.json5
{
  "sections": {},              // ✅ Vuoto! (auto-registrato)
  "menuOrder": [],             // ✅ Vuoto! (usa menuWeight)
  "autoPrefix": true           // ✅ Previene conflitti
}
```

**Risultato:**
- ✅ Zero duplicazione
- ✅ Plugin completamente autonomo
- ✅ Configurazione centrale minimale
- ✅ Backward compatible (supporta ancora vecchio formato)

---

## 📞 Next Steps

1. **Review** questo documento e file correlati:
   - [`analysis.it.md`](./analysis.it.md)
   - [`examples.it.md`](./examples.it.md)

2. **Confermare decisioni** D1-D5 (o proporre alternative)

3. **Approvare** implementazione:
   - Alternativa E (Incrementale)
   - Fase 1-4 come da checklist

4. **Iniziare implementazione** (posso procedere se approvato)

5. **Testing** con plugin esistenti

6. **Documentare** in `CLAUDE.md`

---

## ❓ Domande da Risolvere

Prima di procedere, confermare:

**Q1:** Prefisso automatico solo se conflitto rilevato, o sempre?
- [ ] **A:** Solo se conflitto (es. `autoPrefix: "onConflict"`)
- [ ] **B:** Sempre (es. `autoPrefix: "always"`)
- [ ] **C:** Mai (es. `autoPrefix: false`)
- [ ] **D:** Configurabile per plugin (es. plugin specifica preferenza)

**Q2:** Validazione convenzioni sotto-pagine?
- [ ] **A:** Nessuna (libertà totale)
- [ ] **B:** Warning se non segue convenzione (soft)
- [ ] **C:** Errore se non segue convenzione (strict)

**Q3:** Backward compatibility per quanto tempo?
- [ ] **A:** Permanente (supporta sempre vecchio formato)
- [ ] **B:** Deprecato ma funzionante (warning)
- [ ] **C:** Rimosso in prossima major version

**Q4:** Tool migrazione automatica?
- [ ] **A:** Sì, script CLI per migrare plugin esistenti
- [ ] **B:** No, migrazione manuale documentata
- [ ] **C:** Opzionale, fornito ma non obbligatorio

---

**Pronto per procedere?** Conferma le decisioni e posso iniziare l'implementazione! 🚀

---

**Autore:** AI Assistant
**Data:** 2026-01-03
**Versione:** 1.0.0
