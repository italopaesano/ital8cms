<!-- ital8doc v1-1 · tipo: README · lang: it · rev: 1 · ref -->
# `decoys/default/` — i contenuti fittizi distribuiti col plugin

Questi file sono **versionati**: un aggiornamento di ital8cms li sovrascrive. Per
modificarne uno, copialo in [`../data/`](../data) con lo stesso nome — quella
copia ha la precedenza e non viene mai toccata. Vedi
[`../README.md`](../README.md) per il perché delle due cartelle.

> **La spiegazione di un decoy non può stare dentro il decoy.**
> Un commento HTML o una riga `#` che dice «questo è finto» viene servita a chi
> ha fatto la richiesta insieme al resto del file: un decoy che si annuncia è
> peggio di un 404, perché ha appena rivelato che c'è un filtro. Per questo le
> descrizioni stanno qui e non lì, e un test le tiene fuori dai file
> (`tests/unit/decoyRenderer.test.js`).

## I file

| File | Cosa imita | A chi è rivolto |
|---|---|---|
| `wp-login.html` | La schermata di `/wp-login.php` | Chi cerca WordPress. Il markup ricalca classi e id veri (`#loginform`, `#user_login`, `.wp-core-ui`) perché è su quelli che gli scanner fanno pattern matching, non sull'aspetto |
| `phpinfo.html` | L'output di `phpinfo()` | Chi cerca un `phpinfo()` dimenticato in produzione: versione dell'interprete, estensioni, percorsi assoluti. Qui è tutto inventato, e la versione dichiarata (7.4.33) è **vecchia e vulnerabile** di proposito — il tempo successivo se ne va in exploit mirati a un interprete che non gira |
| `env.txt` | Un file `.env` di Laravel | Una delle richieste ostili più frequenti in assoluto. Chiavi e password sono rigenerate a ogni risposta e non corrispondono a nulla |
| `dir-listing.html` | Un indice di directory di `mod_autoindex` | Chi cerca `/backup/`, `/old/`, `/uploads/` con l'autoindex acceso. I nomi dei file sono appetitosi — un dump del database, un archivio — e ogni link porta a un percorso che non esiste |

Nessuno di questi contenuti è vero: ital8cms non esegue PHP, non usa file `.env`
(la configurazione sta in `ital8Config.json5`) e non ha autoindex.

## Cosa NON fanno

**Non registrano i tentativi.** Il finto login rimanda a se stesso e non guarda
cosa gli è stato inviato. Raccogliere i tentativi è il **Livello 3**
dell'evoluzione delle trappole (vedi [`../../TODO.md`](../../TODO.md)) e porta con
sé un vincolo assoluto: mai salvare in chiaro password che sono quasi sempre
credenziali vere rubate ad altri siti.

**Non sono canary token.** Le credenziali fasulle diventano un canary solo quando
una regola trappola sorveglia l'URL o l'account corrispondente — **Livello 2**. Un
canary che nessuno sorveglia è solo un'esca che nessuno raccoglie.

## Se ne scrivi uno

Le regole stanno in [`../README.md`](../README.md). Le due che si dimenticano più
spesso:

- **Niente EJS, niente partial del tema.** I decoy sono serviti fuori dalla
  pipeline di rendering.
- **Nessuna spiegazione dentro il file** — vedi il riquadro qui sopra.

I segnaposto disponibili (`{{today}}`, `{{random:N}}`, `{{choice:a|b|c}}`,
`{{path}}`, `{{ip}}`, `{{now}}`, `{{timestamp}}`) sono documentati in
[`../../README.it.md`](../../README.it.md). Servono a far sì che due risposte non
siano mai identiche: un decoy uguale a se stesso viene riconosciuto da un hash
del contenuto e smette di ingannare.
