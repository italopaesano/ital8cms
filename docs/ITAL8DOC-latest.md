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

- **Riga 1 di ogni file di doc** = marker di conformità: `<!-- ital8doc vX-Y · tipo: TIPO · lang: LL [· rev: N | · tracks: ll@N] [· ref] -->`
- **Riga 2 dei doc bilingui** = nota umana **in inglese** che indica qual è il file di riferimento sempre aggiornato.
- **README** = *"come lo USO?"* — **EXPLAIN** = *"1) PERCHÉ è fatto così? 2) come lo modifico / regolo al meglio?"*
- **Multilingua (§4):** i doc *pubblicabili come repo* (README/EXPLAIN di plugin/temi, README di root) sono **bilingui** → `nome.md` = **inglese** (faccia pubblica), `nome.it.md` = **italiano** (riferimento). I doc **interni** restano in **italiano** sul nome senza suffisso.
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

**Documenti speciali** riconosciuti ma **non** rimodellati (convenzioni proprie):
`CLAUDE.md` e `CHANGELOG.md`. Portano comunque il marker.

---

## 2. Marker (riga 1) + nota umana (riga 2)

**Riga 1 — marker macchina** (commento HTML, invisibile nel rendering):

```
<!-- ital8doc vX-Y · tipo: TIPO · lang: LL [· rev: N | · tracks: ll@N] [· ref] -->
```

| Campo | Su quali file | Significato |
|-------|---------------|-------------|
| `vX-Y` | tutti | versione dello standard **su cui il file è stato scritto** (`v<major>-<minor>`) |
| `tipo` | tutti | `README` \| `EXPLAIN` \| `guide` \| `decision` \| `index` \| `reference` |
| `lang` | tutti | lingua del file (`it`, `en`, …) |
| `rev` | file di **riferimento** | revisione del documento (intero, bump solo a modifica **sostanziale**) |
| `tracks` | file **tradotto** | `ll@N` = la `rev` del riferimento da cui è stato sincronizzato |
| `ref` | file di **riferimento** | flag: questo è il file fonte di verità |

**Riga 2 — nota umana in inglese** (solo nei doc **bilingui**, vedi §4). È un
blockquote `>` → si vede in cima su GitHub e spiega a chiunque dove sta la
versione viva:

```markdown
<!-- ital8doc v1-1 · tipo: README · lang: en · tracks: it@4 -->
> 🌐 The authoritative, always-current version is the Italian one → `README.it.md`. This English edition is synced at releases and may lag.
# myPlugin
```
```markdown
<!-- ital8doc v1-1 · tipo: README · lang: it · rev: 4 · ref -->
> 🌐 Italian reference edition (always up to date). The English `README.md` is a translation synced at releases.
# myPlugin
```

I **doc interni** (non bilingui, §4.3) portano solo la riga 1 (niente riga 2).

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
`CLAUDE.md` (puntatore rapido).

**Bump:** 1) copia `-latest.md` in `ITAL8DOC-v<vecchia>.md`; 2) riscrivi
`-latest.md` con nuovo contenuto e numero (titolo + marker); 3) aggiorna la riga
in `CLAUDE.md`.

**Semver:** MAJOR = sezione obbligatoria aggiunta/rimossa/rinominata; MINOR =
tipo/sezione/campo **opzionale** o chiarimento retrocompatibile; PATCH = refuso.

---

## 4. Multilingua

### 4.1 Lingua di riferimento

È quella in cui si scrive per prima ed è sempre aggiornata (vedi selettore in
testa). Attuale: **italiano**. Il file il cui `lang` coincide con la lingua di
riferimento è la **fonte di verità**, a prescindere da quale porti il nome senza
suffisso.

### 4.2 Naming dei doc bilingui

| File | Lingua | Ruolo |
|------|--------|-------|
| `nome.md` | inglese | **faccia pubblica** (nome canonico, mostrato da GitHub) |
| `nome.it.md` | italiano | **riferimento** (fonte di verità, sempre aggiornata) |

Vale per `README` ed `EXPLAIN`. Il nome senza suffisso è **sempre inglese**
perché è ciò che GitHub mostra come faccia di un repository.

### 4.3 A quali documenti si applica il bilingue

| Documento | Schema lingua |
|-----------|---------------|
| README/EXPLAIN di **plugin** e **temi** | **bilingue** (`.md`=en faccia, `.it.md`=it riferimento) |
| README di **root** del repo principale | **bilingue** (`.md`=en) |
| `docs/` (guide, decision, **questo standard**), `core/**` EXPLAIN, CLAUDE.md, CHANGELOG | **solo italiano** sul nome senza suffisso; traduzione non richiesta |

**Razionale:** lo schema bilingue serve a chi **può diventare un repo a sé** (i
plugin/temi sono sviluppabili e importabili come repository separati → hanno una
faccia GitHub propria). I doc interni non lo diventano mai → restano in lingua di
riferimento, senza il costo di una traduzione.

### 4.4 Versionamento dei doc e rilevamento dello stantio

- Il **riferimento** (`.it.md`) porta `rev: N`, incrementato **solo a modifica
  sostanziale** (non per refusi).
- La **traduzione** (`.md`) porta `tracks: it@N` = la `rev` da cui è sincronizzata.
- **Stantio = `rev`(riferimento) − `tracks`(traduzione) > 0**, leggibile a colpo
  d'occhio.

Il `rev` manuale esprime l'**intenzione** ("questa modifica va ritradotta") che
git non sa dedurre. Un check CI git-based (riferimento più recente della `rev`
tracciata) è la rete di sicurezza — **rimandato**, per ora vale il `rev` manuale.

### 4.5 Quando l'inglese è obbligatorio

- **Dentro il monorepo** (sottocartella): `.it.md` obbligatorio (riferimento);
  l'inglese `.md` può mancare (è interno).
- **Pubblicato come repo a sé:** `README.md` inglese **obbligatorio e
  sincronizzato** (è la faccia). È il momento "lo aggiorno per una pubblicazione
  importante".
- Opzionale: lo scaffolder può emettere da subito uno **stub inglese** (titolo +
  nota riga 2) così la faccia non è mai vuota.

### 4.6 Cambio di lingua di riferimento (end-state)

L'inversione "faccia inglese ma riferimento italiano" è una condizione di
sviluppo. Spostando il selettore **reference → en**: l'inglese `.md` diventa
*insieme* faccia **e** riferimento (inversione risolta), e l'`.it.md` diventa la
traduzione con `tracks: en@N`. Stessa macchina, ruoli scambiati.

---

## 5. Tipi di documento

### 5.1 README — *"come lo USO?"*  (obbligatorio per plugin/tema)

```
<!-- ital8doc v1-1 · tipo: README · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `README.md` is synced at releases.
# <nome>
<1 paragrafo: cos'è, quale problema risolve>            ← OBBLIGATORIO
> 📖 Deep-dive tecnico: vedi EXPLAIN(.it).md            ← solo se EXPLAIN esiste
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
> 🌐 Italian reference edition (always up to date). English `EXPLAIN.md` is synced at releases.
# <nome> — Deep-dive tecnico
> Guida d'uso: vedi README(.it).md
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

### 5.3 Guide (`docs/`) — tipo `guide` (interno, italiano)

```
<!-- ital8doc v1-1 · tipo: guide · lang: it -->
# <Titolo della guida>
## Scopo · ## Prerequisiti · ## Procedura · ## Riferimenti
```

### 5.4 Decision record (`docs/decisions/`) — tipo `decision` (interno, italiano)

```
<!-- ital8doc v1-1 · tipo: decision · lang: it -->
# <NNN> — <Titolo della decisione>
## Contesto · ## Decisione · ## Alternative · ## Conseguenze
```

### 5.5 Indice docs (`docs/README.md`) — tipo `index` (interno, italiano)

Tabella "cosa sta dove": guide, decision record, puntatori ai README/EXPLAIN dei
sottosistemi. Solo navigazione, niente contenuto duplicato.

---

## 6. Regole di redazione (tutti i tipi)

1. **Lingua:** vedi §4. Riferimento attuale = italiano. Doc bilingui: `.md`
   inglese / `.it.md` italiano. Doc interni: italiano. Identificatori, keyword,
   nomi di file/funzione/variabile **sempre in inglese**.
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

EXPLAIN **vuoto** = vietato (si cancella).

---

## 8. Conformità & manutenzione

- **Marcare conforme:** marker in riga 1 con la versione su cui hai scritto il
  file; nei bilingui aggiungi la riga 2 inglese.
- **Drift dello standard:** i doc col vecchio numero restano validi finché non
  li revisioni; aggiorna il marker quando li adegui.
- **Drift di traduzione:** mantieni `rev`/`tracks` allineati; al rilascio
  sincronizza l'inglese alla `rev` italiana corrente.
- **Checklist nuovo plugin/tema:** `README.it.md` (riferimento, con marker+riga 2)
  → litmus rispettato → tabella config canonica → `README.md` inglese (almeno
  stub) → EXPLAIN solo se serve, mai vuoto.

---

## 9. Changelog dello standard

- **v1-1** — Aggiunto il supporto **multilingua**: selettore della lingua di
  riferimento, naming bilingue `.md`(en)/`.it.md`(it) per i doc pubblicabili come
  repo, campi marker `lang`/`rev`/`tracks`/`ref`, nota umana in riga 2,
  versionamento dei doc con rilevamento dello stantio, regola di applicabilità
  (bilingue vs interni) e cambio di lingua di riferimento. Bump MINOR
  (retrocompatibile: i campi nuovi sono opzionali).
- **v1-0** — Prima edizione. Marker di conformità, schema di versionamento
  `-latest`/`-v<x-y>`, tipi README/EXPLAIN/guide/decision/index/reference con
  scheletri, regole di redazione, matrice di obbligatorietà.
