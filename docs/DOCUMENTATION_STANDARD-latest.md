<!-- ital8doc v1.0 · tipo: reference -->
# Standard di Documentazione ital8cms — v1.0

> **Stato: CORRENTE.** Questo file (`DOCUMENTATION_STANDARD-latest.md`) è sempre
> la versione corrente dello standard. Le versioni passate sono archiviate come
> `DOCUMENTATION_STANDARD-V<x.y>.md`. La versione corrente è citata anche in
> `CLAUDE.md` (fonte di verità rapida per "qual è l'attuale").

---

## 0. In breve (TL;DR)

- **Riga 1 di ogni file di doc** = marker di conformità: `<!-- ital8doc vX.Y · tipo: TIPO -->`
- **README** risponde a *"come lo USO?"* — **EXPLAIN** risponde a *"1) PERCHÉ è fatto così? 2) come ne modifico il comportamento / lo regolo al meglio?"*
- **README** è obbligatorio per ogni plugin e tema; **EXPLAIN** è opzionale (solo se ci sono interni non banali). Un EXPLAIN vuoto è vietato.
- **Lingua: italiano.** Identificatori, keyword, nomi di file/funzione restano in inglese (stanno nel codice).
- Le **tabelle di configurazione** hanno fonte unica nel README; l'EXPLAIN le ri-cita solo per spiegarne il meccanismo, mai per ricopiarle.

---

## 1. Scopo e ambito

Questo standard governa **tutta** la documentazione versionabile del progetto:

- `README.md` (plugin, tema, cartelle, root)
- `EXPLAIN.md` (plugin, tema, sottosistemi core)
- Guide operative in `docs/` (es. `deployment.md`, `testing.md`)
- Decision record in `docs/decisions/`
- L'indice `docs/README.md`

**Documenti speciali** riconosciuti ma **non** rimodellati da questo standard
(seguono convenzioni proprie): `CLAUDE.md` (guida operativa per l'AI) e
`CHANGELOG.md` (storico del progetto). Possono comunque portare il marker.

---

## 2. Il marker di conformità (riga 1)

Ogni file di documentazione **inizia** con un commento HTML in riga 1:

```
<!-- ital8doc vX.Y · tipo: TIPO -->
```

- È un commento HTML → **invisibile nel rendering**, visibile nel sorgente
  (l'equivalente markdown del commento `//` in testa ai file `.json5`).
- `vX.Y` = la versione dello standard **sulla cui base il file è stato scritto**
  (stamp di conformità, non necessariamente l'ultima esistente).
- `TIPO` ∈ { `README`, `EXPLAIN`, `guide`, `decision`, `index`, `reference` }.
  Dichiara quale contratto di sezioni segue il file.

**Regola di risoluzione** (come trovare il testo dello standard a cui un file
si conforma): leggi `vX.Y` nel marker → se coincide con la versione corrente
(dichiarata in `CLAUDE.md`) leggi `DOCUMENTATION_STANDARD-latest.md`; altrimenti
leggi l'archivio `DOCUMENTATION_STANDARD-VX.Y.md`.

---

## 3. Versionamento dello standard

**Schema dei file:**

| File | Ruolo |
|------|-------|
| `docs/DOCUMENTATION_STANDARD-latest.md` | La versione **corrente** (questo file) |
| `docs/DOCUMENTATION_STANDARD-V<x.y>.md` | Una versione **passata**, archiviata |

**Dove vive il numero corrente:** è dichiarato (a) nel titolo di questo file e
(b) in una riga di `CLAUDE.md`. `CLAUDE.md` è il puntatore rapido; questo file è
il testo autorevole.

**Processo di avanzamento (bump):**
1. Copia il `-latest.md` attuale in `DOCUMENTATION_STANDARD-V<vecchia>.md` (archivio).
2. Riscrivi `-latest.md` con il nuovo contenuto e il nuovo numero in titolo + marker.
3. Aggiorna la riga della versione corrente in `CLAUDE.md`.

**Semver dello standard:**
- **MAJOR** — una sezione obbligatoria è aggiunta/rimossa/rinominata (i doc
  esistenti diventano non conformi: serve revisione).
- **MINOR** — nuovo tipo o sezione **opzionale**, oppure chiarimento retrocompatibile.
- **PATCH** — refuso o riformulazione senza impatto sulle regole.

**Drift detection:** se un doc dichiara `v1.0` ma il corrente è `v1.2`, il doc
è candidato a revisione. Lo stamp per-file rende questo controllo immediato.

---

## 4. Tipi di documento

### 4.1 README — *"come lo USO?"*  (obbligatorio per plugin/tema)

Lettore: chi vuole **usare** l'unità (installarla, chiamarne l'API, configurarla)
senza sapere come funziona dentro.

```
<!-- ital8doc v1.0 · tipo: README -->
# <nome>
<1 paragrafo: cos'è, quale problema risolve>            ← OBBLIGATORIO
> 📖 Deep-dive tecnico: vedi EXPLAIN.md                  ← solo se EXPLAIN esiste
## Cosa fa            — elenco funzionalità
## Uso / Quick start  — esempio minimo funzionante
## API / Contratto    — rotte, oggetto condiviso, funzioni template
## Configurazione     — tabella campi `custom` (RIFERIMENTO CANONICO)
## File               — mappa sintetica
## Dipendenze
```

Sezioni **obbligatorie**: marker, H1 col nome, paragrafo introduttivo. Le altre
sono raccomandate "se applicabili" (un plugin senza config salta *Configurazione*).

### 4.2 EXPLAIN — *"perché è fatto così + come lo regolo"*  (opzionale)

Lettore: chi deve **modificare**, fare debug, o **capire a fondo** l'unità — o
studiarla come pattern di riferimento. Si scrive **solo** se gli interni sono non
banali. Un EXPLAIN vuoto o ridondante col README è vietato.

```
<!-- ital8doc v1.0 · tipo: EXPLAIN -->
# <nome> — Deep-dive tecnico
> Guida d'uso: vedi README.md
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

L'ordine è deliberato: prima il **perché** (comprensione), poi il **come
modificarlo/regolarlo** (azione consapevole). Entrambi discendono dagli interni.

### 4.3 Guide (`docs/`) — *"come si fa X nel progetto"*  (tipo `guide`)

Per topic operativi trasversali (deploy, testing, HTTPS, profilo demo).

```
<!-- ital8doc v1.0 · tipo: guide -->
# <Titolo della guida>
## Scopo            — cosa copre, per chi
## Prerequisiti
## Procedura        — passi numerati / scenari
## Riferimenti      — link a file/altre guide
```

### 4.4 Decision record (`docs/decisions/`) — *"perché abbiamo deciso X"*  (tipo `decision`)

Registro immutabile di una scelta architetturale (stile ADR).

```
<!-- ital8doc v1.0 · tipo: decision -->
# <NNN> — <Titolo della decisione>
## Contesto         — il problema, i vincoli
## Decisione        — cosa si è scelto
## Alternative       — opzioni scartate e perché
## Conseguenze      — effetti positivi/negativi, follow-up
```

### 4.5 Indice docs (`docs/README.md`) — (tipo `index`)

Tabella "cosa sta dove": elenca guide, decision record e i puntatori ai README/
EXPLAIN dei sottosistemi. Niente contenuto duplicato, solo navigazione.

---

## 5. Regole di redazione (valide per tutti i tipi)

1. **Lingua italiana.** Identificatori, keyword, nomi di file/funzione/variabile
   in inglese.
2. **Rimando incrociato.** Se esistono entrambi, README ed EXPLAIN si linkano a
   vicenda con un box in testa (vedi scheletri).
3. **Fonte unica per le tabelle di config/API.** Il riferimento canonico è nel
   README; l'EXPLAIN ri-cita un campo solo per spiegarne meccanismo o trade-off.
4. **Niente dati volatili.** Vietati nel corpo: conteggi di test esatti
   ("131 test"), riferimenti a numeri di riga ("lines 874-1064"), versioni
   puntuali di dipendenze. Usa riferimenti stabili ("vedi `tests/`", "vedi
   `package.json`"). Invecchiano e generano incoerenze.
5. **Esempi corretti per definizione.** Il codice negli esempi deve rispettare i
   contratti del progetto (es. il campo `access` obbligatorio nelle rotte). Un
   esempio che, copiato, non funziona è un bug della documentazione.
6. **Heading.** Un solo `# H1` (il titolo) per file; gerarchia coerente sotto.

---

## 6. Matrice di obbligatorietà

| Unità | README | EXPLAIN |
|-------|--------|---------|
| Plugin | **obbligatorio** | opzionale (se interni non banali) |
| Tema | **obbligatorio** | opzionale |
| Sottosistema core (es. `core/admin/`) | consigliato | consigliato |
| Guida / decision record in `docs/` | n/a (sono `guide`/`decision`) | n/a |

EXPLAIN **vuoto** = vietato (si cancella, non si riempie per forza).

---

## 7. Conformità & manutenzione

- **Marcare conforme:** aggiungi il marker in riga 1 con la versione su cui hai
  scritto il file.
- **Gestire il drift:** quando lo standard avanza, i doc col vecchio numero
  restano validi finché non li revisioni; aggiorna il marker quando li adegui.
- **Checklist minima per un nuovo plugin/tema:** README con marker → litmus
  rispettato → tabella config canonica → (EXPLAIN solo se serve, mai vuoto).

---

## 8. Changelog dello standard

- **v1.0** — Prima edizione. Definisce marker di conformità, schema di
  versionamento `-latest`/`-V<x.y>`, i tipi README/EXPLAIN/guide/decision/index/
  reference con i rispettivi scheletri, le regole di redazione e la matrice di
  obbligatorietà.
