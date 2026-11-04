<!-- ital8doc v1-1 · tipo: reference · lang: it -->
# Changelog delle migrazioni — seo

Storico degli step di migrazione dei config di questo pacchetto (dal più recente).

- **v1 → v2** — *robotsTxtRules.disallow passa ai segnaposti di percorso*
  I percorsi distribuiti in `custom.robotsTxtRules.disallow` passano dai letterali ai **segnaposti di
  percorso** (`{{admin}}`, `{{api}}`, …), così seguono i prefissi configurati
  invece di descrivere un comportamento diverso da quello in vigore.
  Fase 5 di [`path-zones.it.md`](../../../docs/decisions/path-zones.it.md).
  Dettaglio e verifica → [`from-v1-to-v2.md`](./from-v1-to-v2.md).
