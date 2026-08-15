# sentinel · da v5 a v6 — `shell-probe` richiede un'estensione eseguibile

## Cosa cambia

Il pattern della regola `shell-probe` in `sentinelRules.json5`:

```diff
- path: "regex:/(c99|r57|wso|b374k|shell|cmd|backdoor|webshell)\\."
+ path: "regex:/(c99|r57|wso|b374k|shell|cmd|backdoor|webshell)\\.(php|php3|php4|php5|php7|phtml|asp|aspx|jsp|cgi|pl)$"
```

Il nome della webshell non basta più: serve anche un'**estensione eseguibile**.

## Perché

Il pattern si fermava al punto, quindi intercettava nomi di file del tutto
ordinari:

| Percorso | Prima | Dopo |
|---|---|---|
| `/wp/c99.php` | MATCH | MATCH |
| `/uploads/r57.phtml` | MATCH | MATCH |
| `/js/shell.js` | **MATCH** | — |
| `/assets/cmd.css` | **MATCH** | — |
| `/docs/webshell.pdf` | **MATCH** | — |

`shell` e `cmd` sono nomi comuni: terminali web, moduli CLI, componenti di
documentazione.

**Il punto non è il rumore nel log.** È che il percorso di promozione
documentato nel file delle regole — *«guarda `authenticatedHits`; se è zero dopo
settimane, la regola non ha mai toccato un utente vero e la puoi promuovere
tranquillamente»* — **non può cogliere questo caso**. Un `/js/shell.js` chiesto
dai visitatori anonimi del sito lascia `authenticatedHits` a zero per sempre.

La regola appariva quindi come **la più sicura da promuovere** proprio mentre
promuoverla avrebbe restituito 404 su una pagina pubblica. E la diagnosi sarebbe
partita dal posto sbagliato: il 404 di `block` è deliberatamente indistinguibile
da un file che non esiste, quindi si cercherebbe un errore di deploy.

## Cosa si perde

Una webshell caricata con un'estensione innocua (`shell.txt`, `cmd.bak`) non
viene più intercettata da questa regola. È un caso già coperto altrove:
`backup-probe` guarda `.bak`, `.old`, `.swp`, e comunque una webshell che non
viene eseguita dal server non è una webshell — questo CMS non esegue PHP.

Il compromesso è quello dichiarato in testa al file delle regole: meglio una
regola più stretta che si può promuovere, di una più larga che nessuno promuove
mai (o che, promossa, rompe il sito).

## Perché serve una migrazione e non basta il boot

`rules` è un array, e il merge additivo del boot tratta gli array come valori:
una modifica al file distribuito non raggiunge mai un'installazione esistente. È
la stessa ragione degli step [v1→v2](./from-v1-to-v2.md) e
[v2→v3](./from-v2-to-v3.md).

Con una differenza che conta: quelli **aggiungevano** una regola, questo ne
**cambia** una che potresti aver già promosso a `block`. Se l'hai fatto, questa
migrazione ti sta togliendo dei falsi positivi che stavano già rispondendo 404 a
traffico legittimo.

## Cosa fa lo script

`from-v5-to-v6.js`, automatico e idempotente:

1. cerca la regola `shell-probe`; se non c'è, non fa niente;
2. **se il pattern non è esattamente quello distribuito, non tocca niente** e
   scrive un avviso nel log. Un pattern personalizzato è una tua scelta, e una
   migrazione che la sovrascrive perché «sa di saperne di più» è il modo di far
   perdere fiducia in tutte le migrazioni successive;
3. altrimenti riscrive **la sola riga** `path:` di quella regola, conservando
   virgolette, rientro e ogni commento del file;
4. verifica differenziale: parsa prima, parsa dopo, e pretende che l'unica
   differenza sia `rules[<i>].match.path`. Se non lo è, non scrive niente;
5. scrittura atomica (temp + rename).

## Se preferisci non applicarla

La regola resta legittima com'è. Se il tuo sito non ha file chiamati `shell.*` o
`cmd.*`, il pattern vecchio non ti fa alcun danno — controlla i percorsi nel log
prima di decidere:

```bash
grep '"ruleName":"shell-probe"' plugins/sentinel/data/sentinel-*.jsonl \
  | grep -o '"path":"[^"]*"' | sort | uniq -c | sort -rn
```

Se vedi solo `.php` e simili, sei nel caso in cui la migrazione non cambia nulla
per te.

## Verifica

```bash
npm run cli -- migrate sentinel --dry-run
npm run cli -- migrate sentinel

# la regola non deve più intercettare un asset legittimo
npm run cli -- sentinel test /js/shell.js
npm run cli -- sentinel test /wp/c99.php
```

La prima deve riportare nessun match su `shell-probe`, la seconda il match.

## Nota

La `description` della regola non viene riscritta: sulle installazioni migrate
resta quella breve, sulle nuove c'è la versione estesa che spiega il perché
dell'estensione. È una differenza di testo senza effetti sul comportamento, e
riscrivere un blocco multi-riga di testo libero costa più rischio di quanto
valga.
