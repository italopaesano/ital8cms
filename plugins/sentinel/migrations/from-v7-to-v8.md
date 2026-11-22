<!-- ital8doc v1-1 · tipo: guide · lang: it · rev: 1 · ref -->
# sentinel · da v7 a v8 — le tre regole `regex:` sopravvivono all'ancoraggio

## Cosa cambia

Le **due** regole distribuite che usano un `regex:` su un **path** vengono
riscritte con i `.*` **espliciti**:

| Regola | Prima | Dopo |
|---|---|---|
| chiavi SSH | `regex:/id_(rsa\|dsa\|ecdsa\|ed25519)$` | `regex:.*/id_(rsa\|dsa\|ecdsa\|ed25519)` |
| webshell note | `regex:/(c99\|r57\|…)\.(php\|…)$` | `regex:.*/(c99\|r57\|…)\.(php\|…)` |

**La regola sulla querystring NON è toccata**, e la ragione va detta perché il
prefisso `regex:` è lo stesso e la somiglianza inganna: le regole che guardano
`query`, `userAgent` o un header non passano da `core/patternMatcher`. Sentinel
le compila da sé in `lib/ruleValidator.js → compileRegex()`, con
`new RegExp(source, 'i')` — senza ancoraggi e case-insensitive. L'ancoraggio non
le riguarda. (Verificato leggendo quel compilatore: una prima stesura di questa
migrazione riscriveva anche quella riga, inutilmente.)

Il comportamento osservabile è **identico a prima**: ciò che era implicito
nell'assenza di ancoraggi diventa esplicito.

## Perché

Dalla v3.43.0 `core/patternMatcher.js` compila il corpo di un `regex:` come
`^(?:corpo)$` — la correzione di `REVIEW.md` → **A4**. Prima non lo faceva, e
`RegExp.test()` senza ancoraggi è un match di **sottostringa**: per chi
*protegge* URL era un difetto grave (`regex:/admin/users` matchava anche
`/public/admin/users`, e le regex hanno priorità 500, sopra i wildcard).

**Ma sentinel non protegge: rileva**, e queste tre regole usavano il match
parziale **di proposito**. Una chiave SSH o una webshell vanno intercettate in
qualunque cartella; le sequenze di risalita in qualunque punto della query.

**Misurato** con l'ancoraggio attivo e senza questa riscrittura:

```
/.ssh/id_rsa              prima true  →  dopo false
/uploads/img/shell.php    prima true  →  dopo false
```

Le due regole restano nel file, **valide e inerti**. È lo stesso difetto dello
step 6→7 per un'altra strada: una regola che c'è e non osserva più niente.

## Perché serve una migrazione e non basta il boot

`rules` è un **array**, e il merge additivo del boot tratta gli array come
valori — scelta giusta, perché fonderli significherebbe indovinare la posizione
e sovrascrivere l'ordine deciso dall'amministratore. Quindi una regola
riscritta nel `.default` non raggiunge mai un'installazione esistente da sola.

## Cosa fa lo script

`from-v7-to-v8.js` sostituisce **le due righe esatte** come sono distribuite.
Ogni riga è indipendente: se una delle due corrisponde e l'altra no, converte
quella che corrisponde e **segnala** l'altra. Scrittura atomica (temp + `rename`). Idempotente: dopo il
primo passaggio le righe di partenza non ci sono più.

## Cosa si perde

Niente, se le regole sono quelle distribuite.

Se le hai **personalizzate**, lo script non le tocca e stampa un avviso: vanno
riscritte a mano anteponendo `.*` al corpo (e aggiungendone uno in coda, se la
regola cercava *dovunque* e non *in fondo*). Una regola `regex:` personalizzata
e non riscritta **non intercetta più nulla**: è il motivo per cui l'avviso dice
cosa fare invece di limitarsi a dire che non ha fatto niente.

## Se preferisci non applicarla

Puoi riscrivere le tre righe a mano con la tabella qui sopra, e poi allineare la
`schemaVersion` del vivo con `npm run cli -- migrate sentinel`. Non applicarla
affatto significa tenere due regole di rilevamento inerti.

## Verifica

```bash
npm run cli -- migrate sentinel --dry-run    # dice quante righe riscriverebbe
npm run cli -- migrate sentinel              # applica
npm run cli -- sentinel test /uploads/shell.php   # deve nominare shell-probe
```

## Nota

Le regole che usano `path` con wildcard (`/.git/**`, `/.env.*`) **non** sono
toccate da questo cambiamento: l'ancoraggio riguarda solo i `regex:`. I
wildcard erano già compilati ancorati.
