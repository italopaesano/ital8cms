# adminConfig — changelog delle migrazioni

Storico dei cambi di struttura di `core/admin/adminConfig.json5`, dal più recente.

- **v1 → v2** (2026-08-08) — Sezione admin del filtro `sentinel`.
  Aggiunge `sections.sentinelManagement` (propagata dal merge additivo del boot)
  e accoda `sentinelManagement` a `menuOrder` (che il merge non tocca, perché è
  un array). Vedi [`from-v1-to-v2.md`](./from-v1-to-v2.md).
