# CLAUDE-DOC - Documentazione AI-Generated per ital8cms

Questa cartella contiene tutta la documentazione generata da Claude AI per facilitare lo sviluppo, la comprensione e la manutenzione di ital8cms.

## 📚 Contenuto

### [CLAUDE.md](./CLAUDE.md)
**Guida completa per AI assistants** che lavorano sul progetto ital8cms.

**Contenuti:**
- Panoramica progetto e filosofia file-based
- Struttura codebase dettagliata
- Technology stack (Koa v3, EJS, JSON5, etc.)
- Sistema plugin: architettura, lifecycle, comunicazione inter-plugin
- Sistema temi: struttura, partials, template
- Strategia storage dati (JSON files vs database opzionale)
- Autenticazione e autorizzazione (RBAC)
- Convenzioni codice e best practices
- Workflow sviluppo (creare plugin, temi, API routes)
- Riferimento completo oggetto `passData`
- Task comuni con esempi pratici

**Target:** AI assistants (Claude, GPT, etc.) che contribuiscono al progetto

---

### [CODING_STYLE.md](./CODING_STYLE.md)
**Guida allo stile di codifica e documentazione** del progetto ital8cms.

**Contenuti:**
- Stile JavaScript (const/let, Array(), Map(), async/await)
- **Commenti in italiano** (caratteristica distintiva del progetto)
- Struttura plugin standard
- Pattern architetturali comuni
- Convenzioni naming (camelCase, PascalCase, etc.)
- Esempi di codice commentati
- Linee guida per nuovi plugin
- Best practices specifiche del progetto

**Target:** Sviluppatori e AI che scrivono codice per ital8cms

---

### [MIGRATION_KOA_V3.md](./MIGRATION_KOA_V3.md)
**Documentazione migrazione da Koa v2 a Koa v3 e koa-classic-server v2.1.2**

**Contenuti:**
- Breaking changes Koa v2 → v3
- Nuove feature koa-classic-server v2.1.2
- Modifiche al codice (index.js)
- HTTP caching (ETag, Last-Modified, 304 responses)
- Benefici performance e sicurezza
- Before/after code examples
- Checklist compatibilità

**Target:** Sviluppatori che aggiornano o mantengono il progetto

---

## 🎯 Scopo della Cartella

Questa cartella centralizza:
- ✅ Guide tecniche per AI assistants
- ✅ Documentazione architetturale
- ✅ Guide di migrazione e upgrade
- ✅ Best practices e convenzioni
- ✅ Esempi di codice pratici

## 📝 Note

**Non modificare manualmente** questa documentazione senza coordinare con:
1. L'AI assistant che ha generato il contenuto
2. Il maintainer del progetto (Italo Paesano)

Questi documenti sono **living documents** che vengono aggiornati quando:
- L'architettura del progetto cambia
- Vengono aggiunte nuove feature
- Si effettuano migrazioni importanti
- Si scoprono nuovi pattern o best practices

## 🔗 Collegamenti

- **Progetto principale:** [ital8cms](../)
- **Autore:** Italo Paesano (italopaesano@protonmail.com)
- **Repository:** [GitHub](https://github.com/italopaesano)

---

**Generato da:** Claude AI (Anthropic)
**Ultima revisione:** 2025-11-19
**Versione progetto:** 0.0.1-alpha.0
