<!-- ital8doc v1-1 · tipo: decision · lang: it · ref -->
# Decisione aperta: campi `active` / `isInstalled` in `themeConfig.json5`

> **Stato: APERTA** (da decidere). Estratta da CLAUDE.md durante il riordino della documentazione.

## Contesto

I campi `active` e `isInstalled` in `themeConfig.json5` sono attualmente **solo cosmetici**: vengono mostrati nei badge della UI admin (`themesManagment/index.ejs`, `themeView.ejs`) ma **non guidano alcuna logica**. Il tema effettivamente attivo è determinato unicamente da `ital8Config.json5` (`activeTheme`, `adminActiveTheme`).

**Convenzione attuale (cleanup 2026-05-26):**
- `active: 1` → **solo** sul tema corrispondente a `ital8Config.json5.activeTheme` o `adminActiveTheme`
- `active: 0` → su tutti gli altri temi bundled
- `isInstalled: 1` → su tutti i temi bundled (sono installati per definizione)
- `themesInstall.js` (installazione da repo Git) forza `active: 0, isInstalled: 0` sui temi clonati

## Alternative

1. **Mantenere lo stato attuale come cosmetico** — `active` e `isInstalled` restano metadata visualizzati ma non funzionali. Va documentato chiaramente che la fonte di verità è `ital8Config.json5`.

2. **Allineare al flusso install** — `setActiveTheme` mantiene l'invariante: deattiva il flag nel vecchio tema, attiva nel nuovo. Aggiunge complessità (due scritture atomiche per cambio tema) ma rende i flag funzionali e coerenti.

3. **Eliminare i campi** — rimuovere `active` e `isInstalled` da `themeConfig.json5` e dalla UI. La fonte di verità diventa solo `ital8Config.json5`, eliminando ogni ambiguità.

## Vincoli

`themesInstall.js` attualmente forza entrambi a 0 dopo il clone. Qualsiasi decisione deve essere coerente con questo flusso o modificarlo.

## Stato attuale

Per ora `setActiveTheme()` **non** tocca i flag nei `themeConfig.json5`: aggiorna solo `ital8Config.json5`. La decisione su quale opzione adottare è rimandata.
