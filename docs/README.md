<!-- ital8doc v1-1 · tipo: index · lang: it -->
# Documentazione ital8cms

Indice della documentazione. La guida operativa per l'AI e l'architettura in sintesi sono in [`../CLAUDE.md`](../CLAUDE.md).

## Standard

- [`ITAL8DOC-latest.md`](./ITAL8DOC-latest.md) — Standard di Documentazione del progetto (**ital8doc**, versione corrente). Le versioni passate sono archiviate come `ITAL8DOC-v<x-y>.md`.

## Guide

- [`deployment.it.md`](./deployment.it.md) — deploy in produzione (checklist, PM2, reverse proxy)
- [`https.it.md`](./https.it.md) — configurazione HTTPS (scenari, Let's Encrypt, Strada B/A, NixOS, self-signed)
- [`EXPLAIN-https.it.md`](./EXPLAIN-https.it.md) — deep-dive HTTPS: teoria (certificati, ACME, rinnovo periodico), ital8cms come terminatore TLS, ricette di messa in produzione NixOS (Opzione A/B/C) e reverse proxy
- [`testing.it.md`](./testing.it.md) — strategia e convenzioni di test
- [`demo-profile.it.md`](./demo-profile.it.md) — profilo di installazione demo
- [`roadmap.it.md`](./roadmap.it.md) — miglioramenti e lavori pianificati
- [`security_improvement_for_V3.md`](./security_improvement_for_V3.md) — note di sicurezza per la V3

## Decision record

- [`decisions/`](./decisions/) — registri di decisioni architetturali (admin plugin pages, project review, campi tema `active`/`isInstalled`)

## Archivio (storico / spunto)

- [`archive/`](./archive/) — snapshot storici e materiale obsoleto conservato come spunto per future riscritture (non riflette lo stato attuale)

## Sottosistemi core (deep-dive)

- [`../core/EXPLAIN-pluginsSys.it.md`](../core/EXPLAIN-pluginsSys.it.md) — sistema plugin
- [`../core/EXPLAIN-themeSys.it.md`](../core/EXPLAIN-themeSys.it.md) — sistema temi
- [`../core/EXPLAIN-pluginPages.it.md`](../core/EXPLAIN-pluginPages.it.md) — Plugin Pages System
- [`../core/admin/EXPLAIN.it.md`](../core/admin/EXPLAIN.it.md) — sistema admin

## Plugin

Ogni plugin si documenta in `plugins/<nome>/README.it.md` (obbligatorio) + `EXPLAIN.it.md` (opzionale, se interni non banali). Vedi i puntatori nelle sezioni dei plugin in `CLAUDE.md`.
