<!-- ital8doc v1-1 · tipo: decision · lang: it · ref -->
# Decisione: campi `active` / `isInstalled` in `themeConfig.json5`

> **Stato: RISOLTA** (2026-06-14).

## Contesto

I campi `active` e `isInstalled` in `themeConfig.json5` erano **cosmetici**: mostrati nei badge della UI admin ma non guidavano alcuna logica. Il tema effettivamente attivo è determinato unicamente da `ital8Config.json5` (`activeTheme`, `adminActiveTheme`). Questo creava, per `active`, un **doppio source-of-truth** ambiguo (un tema poteva avere `active: 1` senza essere quello attivo, e viceversa).

## Decisione

1. **`active` — RIMOSSO** dallo schema dei temi. La fonte di verità del tema attivo è **solo** `ital8Config.json5`. È un refactor a basso rischio (nessuna logica runtime dipendeva da `themeConfig.active`: `themeSys` usa già `ital8Config.activeTheme`).
2. **`isInstalled` — MANTENUTO.** Significato (di principio, da affinare in seguito): il tema è **pronto per l'attivazione**, cioè ha tutte le dipendenze e tutti i file presenti (alcuni potrebbero dover essere scaricati). `true` = pronto per essere attivato.

## Cosa è stato modificato

- `themes/*/themeConfig.json5`: rimossa la chiave `active` (7 temi).
- `plugins/admin/themesInstall.js`: rimossa la lettura/scrittura/report di `active`; in fase di finalize ora **elimina** l'eventuale `active` legacy dai temi clonati e mantiene `isInstalled: 0`.
- UI admin (`themesManagment/themeView.ejs`, `install.ejs`): rimossi i badge/righe relativi ad `active`.
- Test (`themesInstall.realRepo.test.js`, `themeSysCheckDependencies.test.js`): aggiornati (asseriscono che `active` non esista più).
- Documentazione (`themes/EXPLAIN.md`, `core/EXPLAIN-themeSys.it.md`, `CLAUDE.md`): esempi e tabelle aggiornati.

## Conseguenze

- Niente più ambiguità su "qual è il tema attivo": una sola fonte (`ital8Config.json5`).
- La semantica operativa di `isInstalled` (cosa lo rende `true`, chi lo imposta, eventuale download dei file mancanti) sarà definita meglio in un secondo momento.

## Storia

La discussione originale (stato cosmetico, convenzione 2026-05-26, le tre opzioni keep / rendi-funzionale / elimina) è confluita qui: **elimina** per `active`, **mantieni** per `isInstalled`.
