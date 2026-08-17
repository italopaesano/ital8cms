# Changelog delle migrazioni di `adminSentinel`

Storico degli step dichiarati in [`migrations.json5`](./migrations.json5), dal
più recente.

Il clock è la `schemaVersion` del **descrittore** (`pluginConfig.default.json5`),
che è la versione di struttura dell'intero pacchetto.

---

## v1 → v2 — cache del riepilogo della panoramica

**Nessuno script:** `custom.summaryCacheSeconds` è una chiave nuova dentro un
oggetto esistente, coperta dal merge additivo ricorsivo del boot.

`GET /summary` rileggeva l'intero log della finestra a ogni richiesta, e la
finestra arriva a un anno. Essendo lettura e parsing sincroni, il costo non
ricadeva sulla dashboard ma sul sito intero, che restava fermo per tutta la
durata — ogni 15 secondi, per ogni scheda aperta. Ora il riepilogo si costruisce
in streaming cedendo il controllo all'event loop, e viene riusato quando i file
non sono cambiati; questa chiave regola il solo caso in cui *sono* cambiati.

→ [`from-v1-to-v2.md`](./from-v1-to-v2.md)
