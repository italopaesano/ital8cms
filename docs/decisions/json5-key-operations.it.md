<!-- ital8doc v1-1 · tipo: decision · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English stub until release.
# Operazioni su chiave `.json5` — `removeJson5Key` e la sostituzione per chiave

**Stato:** decisioni prese, implementazione da fare.
**Aperto il:** 2026-11-01
**Origine:** revisione della Fase 4 di [`path-zones.it.md`](./path-zones.it.md).

---

## Contesto

### Il buco: quattro operazioni su cinque

La libreria `json5` perde i commenti nel round-trip, ed è normale — un parser
produce valori, e i commenti non sono valori:

```
ORIGINALE                        DOPO JSON5.parse + JSON5.stringify
{                                {
  // un commento che documenta     a: 1,
  "a": 1,                        }
}
```

Per questo progetto è però fatale: nei config i commenti **sono** la
documentazione. Di qui lo strato di chirurgia testuale del core, che `CLAUDE.md`
impone al posto di `saveJson5`. Lo strato però copre quattro operazioni su cinque:

| Operazione | Modulo | Stato |
|---|---|---|
| Leggere | `core/loadJson5.js` | ✅ |
| Riscrivere tutto | `core/saveJson5.js` | ✅ (perde i commenti, per costruzione) |
| Aggiornare una chiave esistente | `core/editJson5.js` | ✅ chirurgico |
| Aggiungere-o-aggiornare una chiave | `core/setJson5Key.js` | ✅ chirurgico, anche annidata |
| **Rimuovere una chiave** | — | ❌ **non esiste** |

### Come è emerso

La rimozione mancante è stata **riscritta a mano dentro uno script di
migrazione** (`plugins/adminAccessControl/migrations/from-v3-to-v4.js`, funzione
`dropRuleBlock`), con `indexOf` invece della macchina di scansione che viveva
venti righe più in là. Ne sono usciti due difetti di perdita dati, entrambi
confermati eseguendo lo script:

- **la fine della regola non era la fine di *quella* regola.** `dropRuleBlock`
  cercava « la prima riga di chiusura dopo la chiave ». Su una regola scritta
  **inline** — forma che l'editor JSON5 della GUI consente, perché `saveRules()`
  scrive la stringa grezza dell'amministratore *proprio per* conservarne la
  formattazione — la cancellazione partiva da lì e si fermava alla chiusura di
  una regola **successiva**: misurato, 8 regole custom diventate 3 invece di 4,
  con `/pluginPages/adminUsers/logout.ejs` sparita e `isAuthEntryPoint` con lei;
- **il contenuto non veniva mai guardato.** La funzione riceveva il nome della
  chiave e nient'altro, quindi non poteva distinguere la regola distribuita da
  una che l'amministratore aveva modificato — mentre commento, registro,
  `CHANGELOG` e messaggio di commit promettevano il contrario. Stringendo
  `userProfile` da `allowedRoles: []` a `[0, 1]`, la migrazione la cancellava, e
  con `hideExtension` acceso l'URL ricadeva sul gemello derivato (`[]` =
  qualunque autenticato): una restrizione allentata in silenzio.

Non è stato sbagliato un algoritmo difficile. **Non si è guardato se esistesse
già**, e la quinta operazione — la più difficile delle cinque, perché deve capire
dove *finisce un valore* e non solo dove inizia una chiave — è finita nel posto
con meno scrutinio e zero riuso: uno script che gira una volta per installazione
e poi mai più.

### Una seconda cosa, trovata analizzando la prima

`editJson5` dichiara nel proprio header:

> *« When replacing an object/array LEAF, comments INSIDE the old value are lost
> (the whole block is substituted). »*

La dichiarazione è esatta, ma la conseguenza era stata sottovalutata nella Fase 5
di path-zones, dove `setJson5Key` (che delega a `editJson5`) sostituisce **array**
di pattern. Misurato:

```json5
// PRIMA
"policy": {
  // perché 429 e non 403: è un limite temporaneo
  "status": 429,
  "retryAfter": 60,   // secondi
  // soglia concordata col cliente
  "maxHits": 5,
}
```

Cambiando **solo** `retryAfter` (60 → 120) sono spariti anche i commenti di
`status` e `maxHits`, **i cui valori non erano cambiati**. Un componente che
riscrive `"status": 429` in `"status": 429` e nel farlo cancella la spiegazione
del perché 429 fa danno gratuito: nel caso **oggetto** le chiavi danno identità,
quindi non c'è alcuna ragione tecnica per perdere quei commenti.

Due conseguenze registrate come debito della Fase 5 (vedi *Punti rimandati*):
l'affermazione « `setJson5Key` preserva i commenti del vivo » nei `.md` delle
migrazioni è **troppo larga** (vera fuori dall'array, falsa dentro), e il test
che la verifica mette i commenti **solo fuori**, quindi è cieco al caso che rompe.

---

## Decisioni

### D1 — Un modulo fratello, non una modalità di `editJson5`

`removeJson5Key` è un modulo a sé in `core/`, non un parametro in più di
`editJson5`.

**Perché.** I sei passi di `editJson5` sono: parse+valida → pre-scan → cammina il
path → **sostituisci con `"nome": <valore>`** → **valida ri-parsando che il path
contenga il nuovo valore** → scrivi atomicamente. I passi 2-3 servono alla
rimozione; i passi 4-5 le sono **incompatibili**: il primo è cablato a *produrre*
una coppia chiave-valore (la rimozione deve produrre niente), il secondo verifica
una postcondizione **opposta** (« il path non esiste più »). Anche il valore di
ritorno divergerebbe. Non sono « altri parametri »: è una seconda funzione sotto
lo stesso nome.

**E c'è un precedente del progetto.** `editJson5` dichiara *out of scope*
l'inserimento di chiavi nuove; il progetto poteva aggiungergli una modalità
« crea » e ha invece scritto `setJson5Key` come fratello, che **delega** a
`editJson5` quando la chiave esiste e fa chirurgia propria quando non esiste. La
rimozione segue la forma già scelta per l'inserimento.

**Più una ragione di rischio:** da `editJson5` passa *ogni* scrittura di config
del CMS. Un ramo di cancellazione non collaudato accanto alla primitiva di
aggiornamento più usata significa che un errore sulla rimozione può rompere gli
aggiornamenti. Un fratello può sbagliare senza toccarli.

### D2 — Di chi sono i commenti di una chiave che se ne va

**Una regola sola:** risalendo dalla riga della chiave, appartiene a lei ogni riga
**composta solo da un commento**; si ferma alla prima riga **vuota** o che
contiene **codice**.

I tre casi che questa frase produce:

**A — commento in linea su un'altra chiave: resta dov'è.**

```json5
"userProfile.ejs": { ... },   // nota di userProfile    ← riga CON codice: ferma
"login.ejs": { ... },                                   ← rimuovendo questa, la nota resta
```

**B — commento in linea sulla chiave che se ne va: parte con lei.**

```json5
"login.ejs": { ... },   // varco pubblico     ← se ne va
```

**C — blocco di commenti direttamente sopra: parte tutto.**

```json5
// Pagina di login (deve essere pubblica,
// o nessuno potrebbe autenticarsi)
"login.ejs": { ... },      ← partono entrambe le righe
```

**La fermata sulla riga vuota** — confermata dal maintainer — non inventa una
convenzione: riconosce quella già in uso nei file del progetto. Esempio reale, `plugins/adminAccessControl/accessControl.default.json5`
righe 104-114:

```json5
    // I pattern sono match ESATTI, non wildcard `login*`: il wildcard singolo di
    // ... 8 righe che spiegano TUTTI i varchi, non solo il login
    // Vedi docs/cli-control-plane.it.md → "Superficie riservata".
                                              ← riga vuota
    // Pagina di login (deve essere pubblica, o nessuno potrebbe autenticarsi)
    "{{pluginPages}}/adminUsers/login.ejs": {
```

Rimuovendo `login.ejs`: **con** la fermata parte **1 riga**; **senza**, partono
**10** — cioè la documentazione di sezione che spiega perché esistono *tutti* i
varchi.

> Il precedente da non ripetere: `dropRuleBlock` decideva la proprietà dei
> commenti con una regex su parole italiane (`senza estensione|hideExtension|idem`).
> Cucita su un file, indifendibile come regola generale.

### D3 — Si conservano i commenti. Punto.

> **Questa decisione ha sostituito due stesure precedenti, entrambe sbagliate, e
> la terza è la più semplice.** La prima diceva « gli invariati sì, i cambiati
> no », motivando che un commento potrebbe parlare della *scrittura* invece del
> *significato*. La seconda separava uno strato meccanico da uno editoriale e
> classificava i commenti in `preserved` / `adjacent` / `dropped`. Il maintainer
> ha tagliato: **in questa fase si conservano, senza chiedersi cosa dicono.**

**La regola.** `editJson5` conserva i commenti e **non ragiona sul loro
contenuto**. Non li classifica, non li valuta, non li marca come « da rivedere ».
Mantenerli è tutto ciò che fa.

**La rilettura dei commenti è un'attività separata, manuale e successiva**,
registrata come fase a sé (vedi *Roadmap → Fase 5*) e in
[`TODO.md`](../../TODO.md): a conversione fatta si rileggono **tutti** i commenti
dei file toccati e si decide quali riscrivere. Una persona lo fa in un passaggio;
una funzione non lo farebbe mai bene.

**Perché conservare è la scelta giusta sotto incertezza.** Le due opzioni non
sono simmetriche:

| | Esito | Reversibile? |
|---|---|---|
| **Conservo** un commento diventato falso | affermazione obsoleta, **visibile** a chi apre il file | sì, si riscrive |
| **Cancello** un commento ancora valido | documentazione perduta, **invisibile** | no, senza backup |

Le prime due stesure facevano decidere a una funzione meccanica una questione
editoriale: la prima scegliendo l'opzione distruttiva, la seconda costruendo una
tassonomia per una decisione che non le compete.

#### La conseguenza tecnica: non si ricostruisce, si ricorre

« Conservare senza fare altro » ha una realizzazione precisa, e **più semplice**
di qualunque rimappatura: **non ricostruire il valore.** Se il blocco di testo non
viene rifatto, i commenti non vanno spostati — e quindi non si possono spostare
male.

| Vecchio → nuovo | Strategia | Commenti |
|---|---|---|
| oggetto → oggetto | ricorre **per chiave** | restano dove sono |
| array → array, **stessa lunghezza** | ricorre **per indice** | restano dove sono |
| array → array, lunghezza diversa | sostituzione del blocco | non preservabili → si dichiara |
| cambio di tipo (array ↔ oggetto ↔ scalare) | sostituzione del blocco | non hanno a cui attaccarsi → si dichiara |

Le prime due righe coprono il caso reale della Fase 5 (tre letterali → tre
segnaposti, stessa lunghezza) e il caso misurato nel *Contesto* (un valore
cambiato in un oggetto di tre chiavi). Nessuna corrispondenza da indovinare:
si modifica **l'elemento**, non l'array.

> ⚠ **Capacità da aggiungere.** Lo *Scope* attuale di `editJson5` dichiara fuori
> perimetro la modifica dentro gli array per indice (`path = ['list', 0, 'name']`).
> La ricorsione per indice la richiede. È lavoro delimitato — la macchina di
> scansione sa già trovare la fine di un valore — ma va previsto nella Fase 2.

**Nessuna contraddizione con il merge additivo.** Una stesura precedente
sosteneva che conservare i commenti negli array avrebbe messo `editJson5` in
contraddizione con la scelta di `reconcileSchemaVersion` di trattare gli array
come valori opachi. **Non regge, ed era un errore:** quella scelta riguarda i
**valori** (il merge non aggiunge elementi perché dovrebbe indovinare l'ordine),
questa i **commenti**, che non cambiano alcun valore. Due assi diversi,
sovrapposti per sbaglio.

### D4 — La scansione si estrae in `core/json5Scan.js`

La scansione — `buildCodeMask` (distingue codice da stringhe e commenti),
`buildDepthArray` (profondità di annidamento), `scanValue` (dove finisce un
valore), `skipWsAndComments*`, `findKeyOccurrencesInRegion`, `locatePath` — oggi
vive in `editJson5.js` ed è esportata come `_internals`, che per convenzione
significa « esposto ai test ».

**Decisione: estrarla in `core/json5Scan.js`**, importato da `editJson5` e da
`removeJson5Key`. La scansione diventa un pezzo con un nome proprio e nessuno dei
due la possiede. Costa un file in più, ma la Fase 2 della roadmap (la ricorsione
per chiave e per indice) la userà ancora più a fondo, e usare `_internals` da un
modulo di produzione lascerebbe un nome che dichiara il contrario di quello che fa.

**Il nome** (approvato dal maintainer fra tre alternative) dice **scansione** e
non *edit*: il modulo è di **sola lettura** — legge il testo e dice dov'è cosa,
non modifica niente. Gli scartati erano `json5Locator` (copre male `buildCodeMask`
e `buildDepthArray`, che non localizzano nulla) e `json5TextScan` (`Json5` già
implica che si tratti del file).

```
core/
  json5Scan.js       ← buildCodeMask · buildDepthArray · scanValue · locatePath
  editJson5.js       ← lo importa
  removeJson5Key.js  ← lo importa
```

### D5 — La specifica nuova di `editJson5`

Non « preserva i commenti », che per gli array è una promessa non mantenibile, ma:

> **Preserva i commenti dove esiste identità, e dichiara ciò che non può
> preservare.**
>
> - **oggetto** → sostituzione **per chiave, ricorsiva**: i commenti delle chiavi
>   sopravvissute restano, *anche se il loro valore non cambia*; quelli delle
>   chiavi rimosse se ne vanno con esse (D2);
> - **array** → ricorsione **per indice** a lunghezza invariata, quindi i commenti
>   restano dove sono; a lunghezza diversa non sono preservabili (D3);
> - **cambio di tipo** (array → oggetto, oggetto → scalare) → i commenti interni
>   non hanno più niente a cui attaccarsi: non preservabili per costruzione;
> - in **tutti** i casi non preservabili, il valore di ritorno **riporta cosa è
>   stato scartato**, invece di tacerlo.

L'ultima riga vale più delle altre: il difetto di oggi non è solo che i commenti
si perdono, è che si perdono **in silenzio**. Fosse stato riportato, la
sovra-affermazione nei `.md` della Fase 5 sarebbe caduta da sé.

**La forma del resoconto.** Nessuna tassonomia: solo l'elenco di ciò che **non**
si è potuto conservare, con il percorso in cui stava.

```js
{
  changed: true,
  oldValue, newValue,
  droppedComments: [ { path: ['custom', 'policy'], text: '// …' } ],
}
```

A lunghezza invariata e sugli oggetti l'elenco è **vuoto**, perché non si
ricostruisce niente (D3). Quando non è vuoto, dice esattamente dove il
cambiamento ha dovuto rifare un blocco — ed è l'informazione che serve, invece di
una classificazione di significato che la funzione non è in grado di fare.

**Nota di dipendenza, ed è il motivo dell'ordine della roadmap.** La sostituzione
per chiave richiede tre operazioni per ogni chiave del nuovo valore:

| Per ogni chiave | Operazione | Esiste? |
|---|---|---|
| esisteva, valore diverso | aggiorna in place (ricorsivo) | ✅ `editJson5` |
| non esisteva | inserisci | ✅ `setJson5Key` |
| c'era e ora non c'è | **rimuovi** | ❌ manca |

**Il limite di `editJson5` esiste in parte proprio perché la rimozione non c'è.**
`removeJson5Key` è quindi il **prerequisito** della correzione di `editJson5`, non
il contrario.

---

## Roadmap

### Fase 1 — `removeJson5Key` ✅ FATTA (2026-11-01)

- [x] ~~Estrarre la scansione da `editJson5.js` in **`core/json5Scan.js`** (D4).~~
      Sette funzioni, **zero dipendenze esterne** nel blocco estratto, quindi
      l'estrazione è stata meccanica. `editJson5.js` **da 628 a 278 righe**, e la
      suite è rimasta identica — 178 suite / 5285 test — che è la prova che
      l'estrazione è neutra.
- [x] ~~`json5Scan.js` esporta come **superficie pubblica**, non `_internals`.~~
      E `editJson5._internals` è stato **rimosso**: l'unico consumatore di
      produzione era `setJson5Key.js:180`, che ora importa `json5Scan`
      direttamente. Era l'odore che D4 voleva togliere, e precedeva questo
      intervento.
- [x] ~~Scrivere `core/removeJson5Key.js`.~~ Firma simmetrica ai fratelli
      (`filePath`, chiave stringa o array di segmenti), span da `locatePath`
      estesa in giù (virgola + commento in linea + fine riga) e in su (D2),
      chiave assente → no-op, path ambiguo → rifiuto, scrittura atomica via
      `saveJson5`.
      - [x] **Postcondizione in due parti, verificata PRIMA di scrivere:** il path
            non esiste più **e** tutto il resto del documento è identico. La
            seconda è quella che conta — è la rete che impedisce al difetto
            storico di ripetersi in silenzio, perché una cancellazione che si
            porta via la coppia successiva lascia un file ancora **parsabile**.
      - [x] Confronto via `JSON.stringify` dell'oggetto atteso contro quello
            riletto, **invece di `deepEqual`**: quella utility è già duplicata
            in `editJson5` e `setJson5Key`, e una terza copia era peggio che
            evitarla. (La duplicazione esistente resta, registrata fra i punti
            rimandati.)
      - [x] Lookup dei segmenti via `hasOwnProperty`: senza, `constructor` o
            `toString` pescherebbero dal **prototipo** un valore truthy e la
            funzione crederebbe che la chiave esista. Stessa classe di
            `REVIEW.md` → B4, già incontrata in Fase 1 di path-zones.
- [x] ~~Test: 40, con le forme su cui `dropRuleBlock` ha sbagliato in testa.~~
      Tutte le voci previste, più: due coppie inline di fila, una stringa che
      **contiene** una graffa di chiusura, una virgola **dentro** una stringa,
      chiavi non quotate e apici singoli (JSON5), due coppie sulla **stessa
      riga**, ordine delle chiavi superstiti, e la formattazione del resto del
      file **non normalizzata**.
- [x] ~~**Mutazioni.**~~ Tre, tutte colte — e la prima stesura di una era
      **infedele**, il che è a sua volta la lezione del file: cercava `'},'`
      mentre il difetto vero cercava `'\n  },'`, cioè newline **più
      indentazione**, ed è proprio per questo che su una coppia inline saltava la
      propria chiusura. Corretta, uccide **il test giusto**: « valore INLINE: la
      coppia successiva NON sparisce ». Le altre due: la riga vuota che non ferma
      più la risalita, e la guardia sulla coppia scritta a metà riga.

**Scostamento dal piano, dichiarato.** Il piano prevedeva un ritorno
`{ changed, removedValue, droppedComments }`. `droppedComments` **non c'è**: i
commenti dentro il valore rimosso se ne vanno *perché il valore se ne va*, che è
il comportamento voluto e non una perdita da riportare. L'unico caso di commento
non preso è il blocco `/* … */` su **più righe** sopra la chiave, che resta dov'è
— orfano ma inerte, perché portarne via una parte produrrebbe un file non
parsabile. È documentato nell'intestazione del modulo e coperto da un test;
riportarlo nel valore di ritorno avrebbe richiesto un nome nuovo da approvare per
un caso che i config del progetto non producono (usano `//` ovunque).

### Fase 2 — Sostituzione per chiave in `editJson5`

- [ ] Nel caso **oggetto**, sostituire il blocco intero con una ricorsione per
      chiave: `editJson5` per le chiavi presenti, `setJson5Key` per le nuove,
      `removeJson5Key` per quelle che non ci sono più.
- [ ] Nel caso **array a lunghezza invariata**, ricorrere **per indice** (D3).
      Richiede di estendere `editJson5` alla navigazione dentro gli array per
      indice, oggi dichiarata fuori perimetro nel suo *Scope*.
- [ ] A lunghezza diversa o su cambio di tipo: sostituzione del blocco, e il
      commento perduto finisce in `droppedComments` con il suo percorso.
- [ ] **Non** classificare i commenti per significato: non è lavoro della
      funzione (D3).
- [ ] Test:
      - [ ] il caso misurato in *Contesto*: cambiando `retryAfter`, i commenti di
            `status` e `maxHits` **sopravvivono**;
      - [ ] chiave nuova inserita fra chiavi esistenti, commenti delle vicine intatti;
      - [ ] chiave rimossa porta via il proprio commento e **solo** quello;
      - [ ] annidamento a più livelli;
      - [ ] cambio di tipo → `droppedComments` lo riporta;
      - [ ] la suite esistente di `editJson5` e `setJson5Key` resta **verde**: è il
            vincolo duro, perché da qui passa ogni scrittura di config del CMS.

### Fase 3 — Specifiche e documentazione

- [ ] Riscrivere l'header di `editJson5.js` secondo D5 (lo *Scope* attuale cita
      la perdita come limite: va sostituito, non annotato).
- [ ] Aggiornare `CLAUDE.md` → *Riferimento ai file importanti* con il modulo
      nuovo e quello di scansione.
- [ ] Correggere la **sovra-affermazione della Fase 5**: i `.md` delle migrazioni
      di `rateLimiter` e `seo` dicono che `setJson5Key` « preserva i commenti del
      file vivo » senza la riserva sugli array.
- [ ] Correggere il **test cieco della Fase 5**: `conserva i commenti del file
      vivo` mette i commenti solo *fuori* dall'array; aggiungerne dentro.
- [ ] Voce in `CHANGELOG.md`; voce di tracciamento in `TODO.md`.

### Fase 4 — `from-v3-to-v4.js` riscritta, e il confronto del corpo

- [ ] Eliminare `dropRuleBlock`.
- [ ] La cancellazione delle forme pulite passa per `removeJson5Key` (chiude il
      **difetto 1**).
- [ ] Aggiungere il **confronto del corpo** (chiude il **difetto 2**): `loadJson5`
      dice *se* la regola è quella distribuita, `removeJson5Key` *dove*. Criterio
      da scegliere fra « uguale a quella spedita » e « ancora identica al proprio
      gemello `.ejs` » — il secondo è più aderente al motivo della rimozione (si
      toglie perché è un duplicato, quindi si toglie se è *ancora* un duplicato).
- [ ] Rendere **non silenzioso** il salto delle rinomine (**difetto 3**): oggi un
      `{{…}}` presente altrove nel file fa `continue` prima della lista degli
      scartati, quindi il letterale non viene convertito **né segnalato**.
- [ ] Correggere la diagnostica che **afferma una causa non verificata**
      (**difetto 5**): una regola semplicemente assente riceve il messaggio
      « l'ancoraggio non combacia (file riformattato o personalizzato)… conviene
      convertirli a mano », riferito a una regola che non esiste.
- [ ] Test sulle forme che perdono dati, come in Fase 1, più le due riproduzioni
      del *Contesto* (regola inline, forma pulita modificata) come test di
      regressione.
- [ ] `.gitignore`: il temporaneo `.migrating` non è coperto (**difetto 7**).
- [ ] Riapplicare la migrazione su un'installazione ricostruita « alla v3 » con la
      CLI reale, e verificare che i commenti sopravvivano contandoli prima e dopo.

---

### Fase 5 — Rilettura manuale di TUTTI i commenti

Non è una rifinitura: è la seconda metà di D3. La funzione conserva i commenti
senza giudicarli, quindi dopo la conversione **qualcuno deve rileggerli**.

- [ ] Rileggere **tutti** i commenti dei file toccati dalle fasi 1-4 e decidere
      quali riscrivere. In particolare i commenti che accompagnano valori
      cambiati: un commento che parlava della *scrittura* di un pattern
      (« letterale, da convertire ») è diventato falso quando il pattern è
      diventato un segnaposto.
- [ ] Stessa rilettura sui file già convertiti dalle **Fasi 4 e 5 di
      path-zones**, dove le sostituzioni sono già avvenute:
      `plugins/adminAccessControl/accessControl.json5`,
      `plugins/rateLimiter/pluginConfig.json5`,
      `plugins/seo/pluginConfig.json5`,
      `plugins/sentinel/sentinelRules.json5`.
- [ ] Verificare che nessun commento descriva un comportamento superato — è la
      forma di A1 applicata alla documentazione, e in Fase 4 è già capitata
      (`EXPLAIN.it.md` di `adminAccessControl` consigliava di usare le
      `hardcodedRules` per i path critici, cioè la cosa che A1 aveva smentito).

## Fuori perimetro

- **Una libreria esterna** al posto dello strato del core. Gli editor che
  preservano formattazione e commenti che conosco lavorano su **JSONC**, non
  JSON5 — che ammette chiavi non quotate, apici singoli, virgole finali, numeri
  esadecimali. Non sarebbe un sostituto diretto, e introdurrebbe una dipendenza
  disallineata dai moduli esistenti. Valutabile con dati alla mano se qualcuno lo
  chiede, non a memoria.
- **`renameJson5Key`.** Una rinomina che preservi **posizione e commenti** non è
  esprimibile come `setJson5Key` + `removeJson5Key`: il primo inserisce in cima
  all'oggetto o dopo una chiave indicata, quindi la chiave rinominata si
  **sposterebbe** e perderebbe il blocco di commento che la precede. Sarebbe una
  terza operazione, da valutare quando serve davvero. Le rinomine di
  `from-v3-to-v4.js` restano testuali, e per le rinomine quella strada ha
  funzionato (il difetto 3 è diagnostica, non corruzione).
- **Una primitiva per gli array** (modificare un elemento per posizione o per
  valore). È l'operazione generale dietro il corollario di D3, ma oggi il caso
  d'uso conta tre stringhe in due file: la sostituzione per elemento si può fare
  nello script senza una primitiva nuova.

## Punti rimandati

- [ ] **`deepEqual` è duplicata** in `editJson5.js` e `setJson5Key.js` (precede
      questo intervento). `removeJson5Key` l'ha **evitata** confrontando via
      `JSON.stringify`, per non farne una terza copia, ma le due restano. Il posto
      naturale sarebbe un'utility del core — da valutare se e quando serva a un
      terzo chiamante davvero.

- [ ] **Nessun presidio impone l'ordine « prima `migrations/`, poi il bump »**
      (ereditato dalla Fase 5 di path-zones): bumpare la `schemaVersion` di un
      `.default` senza aver dichiarato lo step fa allineare il vivo dal merge
      additivo al primo boot, **bruciando il trigger**.
- [ ] **Gli harness di boot riscrivono il `ital8Config.json5` VIVO** con
      `JSON.stringify` e lo ripristinano solo in `afterAll` (`TODO.md` §5).

## Storia

- **2026-11-01** — Documento aperto. Decisioni D1-D5 prese. Nessun codice scritto.
- **2026-11-01** — **D2 confermata dal maintainer**, fermata sulla riga vuota
  compresa. **D3 riscritta una prima volta**: il maintainer ha individuato due errori nella prima
  stesura — far decidere a una funzione meccanica una questione editoriale
  (scegliendo l'opzione distruttiva), e una contraddizione col merge additivo che
  non esiste, perché quella scelta riguarda i valori e questa i commenti. Separati
  i due strati; `comments.adjacent` aggiunto a D5 come conseguenza.
- **2026-11-01** — **D3 riscritta una seconda volta, e semplificata dal
  maintainer:** « in questa prima fase conserverei i commenti senza fare altro e
  senza chiedermi cosa dicono ». Via la tassonomia
  `preserved`/`adjacent`/`dropped`: resta il solo elenco dei non preservabili. La
  rilettura dei commenti diventa una **fase manuale a sé** (Fase 5), registrata
  anche in `TODO.md`. Conseguenza tecnica emersa: « conservare senza fare altro »
  si realizza **non ricostruendo** il valore — ricorsione per chiave sugli
  oggetti e per indice sugli array a lunghezza invariata — che richiede di
  estendere `editJson5` alla navigazione negli array per indice.
- **2026-11-01** — **D4 decisa** dal maintainer: la scansione si estrae in un
  modulo condiviso, **`core/json5Scan.js`** (nome scelto fra tre alternative).
  Confermato anche il nome di questo documento. **Nessuna decisione aperta: la
  Fase 1 può partire.**
