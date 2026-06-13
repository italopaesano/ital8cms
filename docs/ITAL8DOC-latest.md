<!-- ital8doc v1-1 · tipo: reference · lang: it · ref -->
# ital8doc — Standard di Documentazione (v1-1)

> **Stato: CORRENTE.** Questo file (`ITAL8DOC-latest.md`) è sempre la versione
> corrente dello standard. Le versioni passate sono archiviate come
> `ITAL8DOC-v<x-y>.md`. La versione corrente è citata anche in `CLAUDE.md`
> (fonte di verità rapida per "qual è l'attuale").

```
╔════════════════════════════════════════════════╗
║  Reference language · lingua di riferimento     ║
║        ▶ it (italiano)      ·      en (english) ║
╚════════════════════════════════════════════════╝
```
La lingua di riferimento è quella in cui si scrive **per prima** e che è
**sempre aggiornata**. Oggi è l'**italiano** (`▶ it`). Può cambiare in futuro
(vedi §4.6): spostando `▶` su `en` la fonte di verità diventa l'inglese.

---

## 0. In breve (TL;DR)

- **Riga 1 di ogni file di doc** = marker: `<!-- ital8doc vX-Y · tipo: TIPO · lang: LL [· rev: N | · tracks: ll@N | · stub] [· ref] -->`
- **Riga 2 dei doc bilingui** = nota umana **in inglese** che indica dov'è il file di riferimento sempre aggiornato.
- **README** = *"come lo USO?"* — **EXPLAIN** = *"1) PERCHÉ è fatto così? 2) come lo modifico / regolo al meglio?"*
- **Multilingua uniforme (§4):** ogni doc = `nome.md` (slot inglese, **stub** finché non si traduce) + `nome.it.md` (**italiano, riferimento, dove si lavora**). Si predispone così la struttura bilingue da subito.
- **Eccezioni** (file caricati per nome da tool/convenzione → restano **unici in italiano**): `CLAUDE.md`, `CHANGELOG.md`, lo standard `ITAL8DOC-*.md`.
- **README** obbligatorio per plugin/tema; **EXPLAIN** opzionale. EXPLAIN vuoto = vietato.

---

## 1. Scopo e ambito

Questo standard governa **tutta** la documentazione versionabile del progetto:
`README.md` ed `EXPLAIN.md` (plugin, tema, sottosistemi core, altre cartelle,
root), le **guide** in `docs/`, i **decision record** in `docs/decisions/` e
l'**indice** `docs/README.md`.

- **README.md** → plugin, tema, sottosistemi core, altre cartelle, root
- **EXPLAIN.md** → plugin, tema, sottosistemi core

Dove **"altre cartelle"** = directory generiche di orientamento (`tests/`,
`scripts/`, `www/`, i contenitori `plugins/` e `themes/`, `docs/`); non avendo
interni da spiegare a fondo, restano fuori dallo scope EXPLAIN.

**Documenti speciali** (esenti dallo schema bilingue, vedi §4.3 — restano file
unici in italiano): `CLAUDE.md`, `CHANGELOG.md` e questo standard.

---

## 2. Marker (riga 1) + nota umana (riga 2)

**Riga 1 — marker macchina** (commento HTML, invisibile nel rendering):

```
<!-- ital8doc vX-Y · tipo: TIPO · lang: LL [· rev: N | · tracks: ll@N | · stub] [· ref] -->
```

| Campo | Su quali file | Significato |
|-------|---------------|-------------|
| `vX-Y` | tutti | versione dello standard **su cui il file è stato scritto** (`v<major>-<minor>`) |
| `tipo` | tutti | `README` \| `EXPLAIN` \| `guide` \| `decision` \| `index` \| `reference` |
| `lang` | tutti | lingua del file (`it`, `en`, …) |
| `rev` | file di **riferimento** | revisione del documento (intero, bump solo a modifica **sostanziale**) |
| `tracks` | file **tradotto** | `ll@N` = la `rev` del riferimento da cui è sincronizzato |
| `stub` | file `.md` **non ancora tradotto** | segnaposto: slot inglese riservato, contenuto solo nel `.it.md` |
| `ref` | file di **riferimento** | flag: questo è il file fonte di verità |

**Riga 2 — nota umana in inglese** (nei doc bilingui). Blockquote `>` → visibile
in cima su GitHub, spiega a chiunque dov'è la versione viva:

```markdown
<!-- ital8doc v1-1 · tipo: README · lang: en · stub -->
> 🌐 Documentation is currently maintained in Italian → see `README.it.md`. The English edition will be filled in at release.
```
```markdown
<!-- ital8doc v1-1 · tipo: README · lang: it · rev: 4 · ref -->
> 🌐 Italian reference edition (always up to date). The English `README.md` is a stub until release.
# myPlugin
```

**Regola di risoluzione dello standard:** leggi `vX-Y` nel marker → se coincide
con la corrente (in `CLAUDE.md`) leggi `ITAL8DOC-latest.md`; altrimenti l'archivio
`ITAL8DOC-vX-Y.md`.

---

## 3. Versionamento dello standard

| File | Ruolo |
|------|-------|
| `docs/ITAL8DOC-latest.md` | versione **corrente** (questo file) |
| `docs/ITAL8DOC-v<x-y>.md` | versione **passata**, archiviata |

**Numero corrente:** dichiarato nel titolo di questo file **e** in una riga di
`CLAUDE.md`. **Bump:** 1) copia `-latest.md` in `ITAL8DOC-v<vecchia>.md`; 2)
riscrivi `-latest.md` con nuovo contenuto e numero; 3) aggiorna `CLAUDE.md`.
**Semver:** MAJOR = sezione obbligatoria aggiunta/rimossa; MINOR = tipo/sezione/
campo opzionale o chiarimento; PATCH = refuso.

---

## 4. Multilingua

### 4.1 Lingua di riferimento

È quella in cui si scrive per prima ed è sempre aggiornata (selettore in testa).
Attuale: **italiano**. Il file il cui `lang` coincide con la lingua di riferimento
è la **fonte di verità**.

### 4.2 Naming uniforme: `.md` (slot inglese) + `.it.md` (riferimento)

| File | Lingua | Ruolo |
|------|--------|-------|
| `nome.md` | inglese | **slot pubblico / faccia GitHub.** Finché non è tradotto è uno **stub**: marker + rimando al `.it.md`, nessun contenuto. |
| `nome.it.md` | italiano | **riferimento**: dove si lavora, sempre aggiornato. |

Il nome senza suffisso è riservato all'inglese perché è ciò che GitHub mostra
come faccia di un repository. **Si lavora sempre sul `.it.md`.**

### 4.3 Regola uniforme e sue eccezioni

**Regola uniforme:** ogni documento — README, EXPLAIN, guide, decision, core
EXPLAIN — esiste come coppia `nome.md` (stub inglese) + `nome.it.md` (contenuto
italiano). La struttura bilingue è predisposta **da subito**: a maturità si
riempiono gli stub `.md` con la traduzione inglese, **senza ristrutturare nulla**.
Fino ad allora il `.md` è poco più di un segnaposto.

**Eccezioni — file unici in italiano** (no stub, no split), perché caricati per
nome esatto da tool/convenzione:

| File | Perché esente |
|------|---------------|
| `CLAUDE.md` | Caricato da Claude Code per nome esatto: uno stub farebbe perdere all'AI tutta la guida |
| `CHANGELOG.md` | Convenzione/tooling di release |
| `ITAL8DOC-*.md` | È lo standard stesso, auto-referenziale |

> Nota: lo stub `.md` rende la faccia GitHub **mai vuota** anche in sviluppo —
> mostra un rimando *in inglese* all'italiano, non un muro di testo italiano.

### 4.4 Versionamento dei doc e rilevamento dello stantio

- Il **riferimento** (`.it.md`) porta `rev: N`, incrementato **solo a modifica
  sostanziale**.
- La **traduzione** (`.md`, una volta riempita) porta `tracks: it@N` = la `rev`
  da cui è sincronizzata. (Da stub, porta `stub`.)
- **Stantio = `rev`(riferimento) − `tracks`(traduzione) > 0**.

Il `rev` manuale esprime l'**intenzione** ("va ritradotto") che git non deduce.
Un check CI git-based è la rete di sicurezza — **rimandato**; per ora vale il
`rev` manuale.

### 4.5 Riempimento dell'inglese a maturità

- Lo **stub `.md`** esiste da subito (uniforme), così la faccia non è mai vuota.
- Il **contenuto inglese** si scrive a maturità / pubblicazione importante:
  si traduce dal `.it.md` corrente e si sostituisce `stub` con `tracks: it@N`.
- Opzionale: lo scaffolder genera in automatico lo stub.

### 4.6 Cambio di lingua di riferimento (end-state)

Spostando il selettore **reference → en**: l'inglese `.md` diventa *insieme*
faccia **e** riferimento (inversione risolta), e l'`.it.md` diventa la traduzione
con `tracks: en@N`. Stessa macchina, ruoli scambiati.

---

## 5. Tipi di documento

Gli scheletri descrivono il **file di riferimento `.it.md`** (dove si lavora).
Lo `nome.md` corrispondente è lo **stub** di §4.2.

### 5.1 README — *"come lo USO?"*  (obbligatorio per plugin/tema)

```
<!-- ital8doc v1-1 · tipo: README · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `README.md` is a stub until release.
# <nome>
<1 paragrafo: cos'è, quale problema risolve>            ← OBBLIGATORIO
> 📖 Deep-dive tecnico: vedi EXPLAIN.it.md              ← solo se EXPLAIN esiste
## Cosa fa            — elenco funzionalità
## Uso / Quick start  — esempio minimo funzionante
## API / Contratto    — rotte, oggetto condiviso, funzioni template
## Configurazione     — tabella campi `custom` (RIFERIMENTO CANONICO)
## File               — mappa sintetica
## Dipendenze
```

Obbligatori: marker, H1, paragrafo introduttivo. Le altre sezioni "se applicabili".

### 5.2 EXPLAIN — *"perché è fatto così + come lo regolo"*  (opzionale)

```
<!-- ital8doc v1-1 · tipo: EXPLAIN · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `EXPLAIN.md` is a stub until release.
# <nome> — Deep-dive tecnico
> Guida d'uso: vedi README.it.md
## Perché è fatto così        — filosofia + vincolo architetturale portante   ← IL CUORE
## Architettura               — componenti, modello dati, macchine a stati
## Flussi                     — diagrammi ASCII
## Moduli interni             — modulo per modulo
## Regolazione & estensione   — tuning consapevole: conseguenze delle scelte
                                di config, trade-off, come estenderne il comportamento
## Sicurezza
## Test                       — cosa copre ogni file (senza conteggi esatti)
## Limitazioni & sviluppi futuri
```

Si scrive **solo** se gli interni sono non banali. Vuoto o ridondante col README = vietato.

### 5.3 Guide (`docs/`) — tipo `guide`

```
<!-- ital8doc v1-1 · tipo: guide · lang: it · rev: 1 · ref -->
# <Titolo della guida>
## Scopo · ## Prerequisiti · ## Procedura · ## Riferimenti
```

### 5.4 Decision record (`docs/decisions/`) — tipo `decision`

```
<!-- ital8doc v1-1 · tipo: decision · lang: it · rev: 1 · ref -->
# <NNN> — <Titolo della decisione>
## Contesto · ## Decisione · ## Alternative · ## Conseguenze
```

### 5.5 Indice docs (`docs/README.md`) — tipo `index`

Tabella "cosa sta dove": guide, decision record, puntatori ai README/EXPLAIN dei
sottosistemi. Solo navigazione, niente contenuto duplicato.

---

## 6. Regole di redazione (tutti i tipi)

1. **Lingua:** vedi §4. Si lavora sul `.it.md` (italiano, riferimento); il `.md`
   è lo stub inglese finché non si traduce. Eccezioni unico-italiano: `CLAUDE.md`,
   `CHANGELOG.md`, lo standard. Identificatori, keyword, nomi di file/funzione
   **sempre in inglese**.
2. **Rimando incrociato.** Se esistono entrambi, README ed EXPLAIN si linkano a
   vicenda con un box in testa.
3. **Fonte unica per le tabelle di config/API.** Il riferimento canonico è nel
   README; l'EXPLAIN ri-cita un campo solo per spiegarne meccanismo o trade-off.
4. **Niente dati volatili.** Vietati nel corpo: conteggi di test esatti, numeri
   di riga, versioni puntuali di dipendenze. Usa riferimenti stabili (`tests/`,
   `package.json`).
5. **Esempi corretti per definizione.** Il codice negli esempi rispetta i
   contratti del progetto (es. campo `access` obbligatorio nelle rotte).
6. **Heading.** Un solo `# H1` per file; gerarchia coerente sotto.

---

## 7. Matrice di obbligatorietà

| Unità | README | EXPLAIN |
|-------|--------|---------|
| Plugin | **obbligatorio** | opzionale (se interni non banali) |
| Tema | **obbligatorio** | opzionale |
| Sottosistema core (es. `core/admin/`) | consigliato | consigliato |
| Altre cartelle (es. `tests/`, `scripts/`) | opzionale (orientamento) | n/a |
| Guida / decision record in `docs/` | n/a (sono `guide`/`decision`) | n/a |

EXPLAIN **vuoto** = vietato (si cancella). Ogni file (tranne le eccezioni §4.3)
implica la coppia `.md`(stub) + `.it.md`(contenuto).

---

## 8. Conformità & manutenzione

- **Marcare conforme:** marker in riga 1 con la versione su cui hai scritto il
  file; nei bilingui aggiungi la riga 2 inglese.
- **Drift dello standard:** i doc col vecchio numero restano validi finché non
  li revisioni; aggiorna il marker quando li adegui.
- **Drift di traduzione:** al rilascio sincronizza l'inglese alla `rev` italiana
  corrente e sostituisci `stub` con `tracks: it@N`.
- **Checklist nuovo plugin/tema:** `README.it.md` (riferimento, marker + riga 2)
  → litmus rispettato → tabella config canonica → `README.md` (stub) → EXPLAIN
  solo se serve, mai vuoto.

---

## 9. Changelog dello standard

- **v1-1** — Supporto **multilingua uniforme**: selettore della lingua di
  riferimento; ogni doc è una coppia `nome.md` (stub inglese) + `nome.it.md`
  (italiano, riferimento), tranne i file caricati per nome (`CLAUDE.md`,
  `CHANGELOG.md`, lo standard) che restano unici in italiano; campi marker
  `lang`/`rev`/`tracks`/`stub`/`ref`; nota umana in riga 2; versionamento dei doc
  con rilevamento dello stantio; cambio di lingua di riferimento. Bump MINOR
  (campi nuovi opzionali, retrocompatibile).
- **v1-0** — Prima edizione. Marker di conformità, schema di versionamento
  `-latest`/`-v<x-y>`, tipi README/EXPLAIN/guide/decision/index/reference con
  scheletri, regole di redazione, matrice di obbligatorietà.
