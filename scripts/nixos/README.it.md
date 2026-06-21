<!-- ital8doc v1-1 · tipo: README · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `README.md` is a stub until release.
# scripts/nixos — Generatore deploy HTTPS per NixOS

CLI interattiva che genera i file di configurazione per servire ital8cms in **HTTPS su NixOS** con Let's Encrypt: i moduli `.nix` (servizio systemd + `security.acme`) e il blocco `https` da incollare in `ital8Config.json5`. Automatizza le ricette di [`docs/EXPLAIN-https.it.md`](../../docs/EXPLAIN-https.it.md) → *Messa in produzione su NixOS* (Opzione A/B/C), evitando di adattare a mano i placeholder.

> 📖 Teoria, scelte e ricette complete: [`docs/EXPLAIN-https.it.md`](../../docs/EXPLAIN-https.it.md) · Guida campi/scenari: [`docs/https.it.md`](../../docs/https.it.md)

## Cosa fa

- Chiede pochi input (layout, challenge, dominio, email, utente/percorso) e li **valida** (dominio, email, percorsi assoluti, username).
- Genera i file giusti per la combinazione scelta e li scrive in una **cartella di output da rivedere**.
- **Non tocca il sistema**: mai `/etc/nixos`, mai il tuo `ital8Config.json5` live. Tu rivedi e applichi.

## Uso / Quick start

```bash
node scripts/nixos/httpsGenerator.js
```

Rispondi alle domande; i file vengono scritti in `./nixos-out` (default, configurabile). Poi segui `ISTRUZIONI.txt` generato.

## Output

| File | Contenuto |
|------|-----------|
| `ital8cms-web.nix` | (solo Opzione A) il servizio systemd che gira come utente di login dalla home |
| `ital8cms-https.nix` | `security.acme` (HTTP-01/DNS-01) + tmpfiles/ordine; in Opzione B include anche utente dedicato e servizio |
| `ital8Config.https.snippet.json5` | il blocco `https` da integrare in `ital8Config.json5` |
| `ISTRUZIONI.txt` | passi (import, rebuild, deploy del codice) + prerequisiti + comandi di verifica |

## Opzioni

| Scelta | Significato | Mappa su EXPLAIN |
|--------|-------------|------------------|
| Layout **A** | servizio come **utente di login**, codice nella home (più semplice) | Opzione A |
| Layout **B** | **utente di servizio dedicato**, codice in `/var/lib/ital8cms` (più isolato) | Opzione B |
| Challenge **HTTP-01** | validazione sulla porta 80 (webroot servito da ital8cms) | A/B con HTTP-01 |
| Challenge **DNS-01** | validazione via record DNS (niente porta 80, supporta wildcard) | Opzione C |

## Note

- Lo strumento è **solo-NixOS** e indipendente dal runtime di ital8cms.
- I template rispecchiano le ricette dell'EXPLAIN: uno **snapshot di asserzioni** in [`tests/unit/nixosHttpsGenerator.test.js`](../../tests/unit/nixosHttpsGenerator.test.js) impedisce derive silenziose.
- Nessuna dipendenza nuova (usa `inquirer`, già nel progetto).

## Test

```bash
npm run test:unit            # include nixosHttpsGenerator.test.js
# oppure mirato:
node_modules/.bin/jest --config=tests/jest.config.js tests/unit/nixosHttpsGenerator.test.js
```

## Riferimenti

- Deep-dive e ricette: [`docs/EXPLAIN-https.it.md`](../../docs/EXPLAIN-https.it.md)
- Guida HTTPS: [`docs/https.it.md`](../../docs/https.it.md)
