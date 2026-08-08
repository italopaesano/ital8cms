<!-- ital8doc v1-1 · tipo: EXPLAIN · lang: it · rev: 1 · ref -->
> 🌐 Italian reference edition (always up to date). English `EXPLAIN.md` is a stub until release.
# sentinel — meccanica interna

Uso e configurazione stanno in [`README.it.md`](./README.it.md). Qui c'è il
*perché* delle scelte non ovvie, cioè quelle che rileggendo il codice fra un anno
sembrerebbero arbitrarie.

---

## 1. Il problema che ha determinato tutta l'architettura

I middleware dei plugin sono montati **dopo il router** (`index.js`, riga ~240).
Per un filtro di perimetro è fatale:

```
POST /api/adminUsers/login   →  il router matcha, l'handler esegue,
                                la catena si ferma lì.
                                Il middleware del plugin non vede nulla.
```

Un filtro che gira dopo il router non è un filtro: è un contatore. E la
superficie che non vedrebbe — `/api/*` — è esattamente quella dove vivono gli
attacchi all'autenticazione.

Ma i plugin vengono caricati **dopo** che i priority middleware sono già montati,
e in Koa non si inserisce un middleware a metà catena a posteriori.

### La soluzione: uno slot che nasce vuoto

Il pattern esisteva già, nel `reservedGate`:

1. `priorityMiddlewares.js` crea e monta il gate — quando i plugin non esistono ancora;
2. `index.js` riga ~201 inietta il pluginSys nel gate;
3. `index.js` riga ~230, **dopo** `pluginSys.initialize()`, gli passa i path riservati.

Il middleware è già al posto giusto mentre il suo contenuto arriva più tardi.
`sentinelGate` fa lo stesso: nasce come pass-through da un `if`, e riceve il
motore dopo il caricamento dei plugin.

Vale la pena notare che il `README.md` legacy di `core/priorityMiddlewares/`
descriveva questo meccanismo — «un elenco dei priority midlware che i vari plugin
potranno richiedere di installare» — anni prima che servisse.

### Posizione nella catena

```
canonical-path gate
  → bodyParser
  → session
  → maintenanceGate      503 uniforme, ha la precedenza su tutto
  → sentinelGate         ← QUI
  → reservedGate         404 mimetico sulla superficie riservata
  → router
  → [middleware dei plugin]   ← dove sentinel NON sta
  → static server
```

| Vincolo | Conseguenza |
|---|---|
| deve vedere `/api/*` | prima del router |
| deve poter esentare/osservare gli utenti loggati | dopo `session` |
| in manutenzione il 503 deve restare uniforme | dopo `maintenanceGate` — se rispondesse 404 mentre il resto dà 503, la differenza sarebbe essa stessa un'informazione |
| deve filtrare le scansioni verso il pannello | prima di `reservedGate` |

Il costo accettato è passare da `bodyParser` anche per le richieste che si
butteranno. In cambio si possono scrivere regole sul body e si ha la sessione.

> **Il default non bloccante non rende superfluo il posizionamento.** Per
> *osservare* `/api/*` bisogna comunque stare prima del router. È l'obiezione che
> verrà in mente a chiunque rilegga il codice: «se non blocca, montiamolo dopo il
> router come analytics». No.

## 2. Ripartizione fra core e plugin

Gli invarianti di sicurezza stanno nel core, l'intelligenza sta nel plugin.

| Responsabilità | Dove | Perché |
|---|---|---|
| il 404 di blocco | **core** | Un solo posto lo produce; un secondo generatore divergerebbe. |
| non decorare i path riservati a superficie chiusa | **core** | È un invariante del reserved gate, non deve dipendere dalla correttezza di un plugin. |
| esenzione `/.well-known/` | **core** | Un errore del plugin non deve poter far scadere il certificato TLS. |
| tetto di enforcement | **core** | Il kill switch deve funzionare anche con un motore impazzito. |
| matching, log, fingerprint, decoy | **plugin** | È il suo dominio. |

Il risultato: un motore sbagliato può al più **non filtrare**. Non può rendere
enumerabile il pannello, non può far cadere l'HTTPS, non può disattivare il kill
switch.

## 3. Perché `verdict.enforce` è una proposta e non un ordine

Il motore restituisce `enforce: true/false` avendo già applicato il tetto della
configurazione (`custom.mode` + `action` della regola). Il gate applica poi il
**proprio** stato come secondo tetto.

Due tetti indipendenti, entrambi in grado di fermare da soli, **nessuno dei due in
grado di forzare** contro l'altro:

| `custom.mode` | stato gate | risultato |
|---|---|---|
| `monitor` | `running` | non agisce |
| `enforce` | `monitor` | non agisce |
| `enforce` | `running` | agisce |
| `enforce` | `stopped` | motore mai interrogato |

Non è ridondanza: uno vive nei file (sopravvive al riavvio, si versiona), l'altro
è a runtime (si commuta in dieci secondi via SSH senza toccare nulla). Servono
momenti diversi.

## 4. Il 404: perché delegare invece di produrre

`reservedGate.deny()` produce un 404 in **due forme diverse** a seconda del path:

- sotto `/api/*` → `text/plain`, corpo `"Not Found"` (9 byte), come farebbe Koa;
- altrove → la pagina HTML di `koa-classic-server` (325 byte) con i suoi 6 header
  di sicurezza.

C'è un test che confronta quella risposta **byte per byte** con un 404 autentico,
perché una risposta «quasi uguale» renderebbe la superficie enumerabile.
Fabbricando un secondo 404 dentro sentinel si sarebbe creata una copia destinata
a divergere alla prima modifica di `koa-classic-server`.

Il commento in testa a quella sezione di `runtimeGate.js` lo dice già: i punti di
enforcement devono rispondere in modo *identico*, e un solo posto che produce il
404 è l'unico modo di garantirlo.

### Differenza nota: `Set-Cookie`

Verificato sul server reale: il corpo e tutti gli header di un blocco sentinel
coincidono con quelli di un 404 autentico, **tranne** che il 404 autentico può
portare un `Set-Cookie` di sessione (`csrfProtection` semina un token nella
sessione più a valle) mentre la risposta di blocco, che ritorna prima, no.

È una proprietà **preesistente** del reserved gate — che ha esattamente la stessa
struttura — e non introdotta da sentinel. È annotata in [`TODO.md`](./TODO.md)
fra i punti aperti: sistemarla significherebbe toccare il modo in cui la sessione
viene committata, e va fatto per entrambi i gate insieme o per nessuno.

## 5. Il fingerprint: la scelta che sembra un errore

**Lo User-Agent non entra nel calcolo dell'impronta.** Rileggendo
`requestFingerprint.js` sembra una dimenticanza: l'UA è il dato più
caratterizzante che una richiesta porti con sé.

È invece il punto centrale. Se l'UA facesse parte della firma, le due cose
varierebbero insieme e sarebbero inconfrontabili. Tenendole indipendenti:

```
UA dichiara Chrome  +  firma da client script  →  uno dei due mente
```

E sappiamo quale: l'UA è l'unico dei due che si cambia con un flag. Il test
`cambiare SOLO lo User-Agent non cambia l'impronta` presidia questa proprietà.

### Perché solo il livello HTTP

| Livello | Perché non c'è |
|---|---|
| TLS (JA3/JA4) | Node non espone il ClientHello; servirebbe un hook sotto `httpsManager`, e funzionerebbe solo terminando il TLS in proprio (non dietro nginx). |
| TCP/IP (p0f) | Richiede raw socket, fuori dallo userland Node. |
| Attivo JS (canvas, font) | **Strumento sbagliato per questa minaccia:** funziona solo su client che eseguono JavaScript, cioè proprio quelli che il filtro non deve fermare. Ed è la categoria giuridicamente più esposta. |

Il livello HTTP è l'unico che qui produca valore, ed è gratis: `ctx.req.rawHeaders`
conserva l'ordine di arrivo.

### Perché la coerenza è valutata in modo conservativo

`coherent: false` scatta solo su `claimedBrowser !== null && headerProfile ===
'minimal'`. Il profilo `partial` **non** è considerato una menzogna: ci finiscono
browser vecchi, proxy che riscrivono gli header e client legittimi atipici. Un
falso allarme su questo segnale svaluterebbe l'unico segnale davvero affidabile
del plugin.

## 6. La querystring viene confrontata due volte

`matchQuery` prova la forma grezza e, se non matcha, quella decodificata.

Il motivo è emerso scrivendo i test: nella querystring uno spazio arriva come `+`
o `%20`, quindi un pattern scritto in modo naturale — `union\s+select` — **non
matcherebbe mai** `union+select`, che è esattamente la forma in cui i tentativi
si presentano. Chiedere a chi scrive le regole di prevedere ogni codifica
significa garantire regole che sembrano giuste e non scattano mai.

Qui è sicuro perché non si instrada nulla, si osserva soltanto: non esiste la
classe di bug «decido sul decodificato, agisco sul grezzo».

## 7. ReDoS: tre difese, tutte necessarie

Le regex arrivano dall'utente e vengono applicate a stringhe controllate
dall'attaccante. Un pattern con backtracking catastrofico — `(a+)+` — contro un
input costruito ad arte blocca l'event loop, cioè **l'intero sito**, con una
singola richiesta. Node non offre timeout sulle regex.

1. **Rifiuto al caricamento** dei pattern con quantificatori annidati
   (`ruleValidator.hasNestedQuantifier`). Euristica grossolana e volutamente
   pessimista: rifiuta anche qualche pattern innocuo, ma un falso rifiuto costa
   una riscrittura mentre un falso permesso costa il sito.
2. **Troncamento degli input** a 512 caratteri prima del test.
3. **Tetto di tempo** di 250 ms sulla valutazione complessiva, nel gate: scaduto,
   si lascia passare.

## 8. Fail-open ovunque

| Situazione | Comportamento |
|---|---|
| `sentinelRules.json5` illeggibile | nessuna regola, sito raggiungibile, errore loggato |
| una regola invalida | scartata, le altre restano |
| il motore lancia | pass-through, errore loggato **una volta sola** |
| il motore si impianta | pass-through dopo 250 ms |
| errore di I/O sul log | scrittura saltata, segnalata una volta |
| state file corrotto | `sentinel: 'running'` |

La ragione è una sola, ripetuta: la probabilità di scrivere una regola sbagliata
è molto maggiore di quella di subire un attacco nei minuti in cui la si corregge.
Un filtro che fallisce fail-closed trasforma una virgola fuori posto in un
blackout.

Il **latch log-once** non è cosmesi: il motore gira su ogni richiesta, e senza
latch un filesystem in sola lettura riempirebbe il journal — trasformando un
guasto in un secondo guasto.

## 9. Gli aggregati sono un vettore di attacco contro sé stessi

Tutte le chiavi degli archivi sono controllate dall'attaccante:

| Archivio | Chiave | Come la si moltiplica |
|---|---|---|
| censimento impronte | fingerprint | randomizzando l'ordine degli header |
| aggregato esiti | IP | con una botnet |

Senza tetto, una `Map` che cresce con l'attacco esaurisce la memoria: la difesa
diventa il vettore. `BoundedStore` impone tetto, TTL e sfratto LRU, con sweep
periodico — la stessa disciplina che `rateLimiter` applica ai blocchi scaduti.

Dettaglio dell'LRU: l'ordine di inserimento di una `Map` è garantito, ma
riscrivere una chiave **non** la sposta in fondo. Da qui il `delete` +
`set` a ogni accesso in `touch()`: rende la prima chiave iterata sempre la meno
usata di recente, e lo sfratto O(1).

**Il contatore di sfratti è un sensore.** In esercizio normale resta a zero per
settimane, perché il traffico vero converge su poche decine di impronte. Un tasso
di sfratto improvviso significa che qualcuno sta producendo chiavi a raffica: la
contromisura si comporta da rilevatore.

## 10. Il tetto di dimensione del log

`retentionDays` protegge dal log che invecchia, non da quello che **cresce**.
Sotto attacco un file giornaliero può prendere gigabyte in poche ore, e un disco
pieno non rompe sentinel: rompe l'intero sito, con una causa che nessuno
collegherebbe al plugin di sicurezza.

Da qui `maxTotalBytes` con sfratto dal più vecchio, e l'allerta a `alertAtPercent`
che scatta **prima**: avvisare mentre si stanno già cancellando dati è inutile.

L'ultimo file non viene mai eliminato: è quello su cui si sta scrivendo, e
cancellarlo perderebbe gli eventi dell'attacco in corso — cioè proprio quelli per
cui il budget è stato superato.

## 11. Scritture riga per riga, non a blocchi

`SentinelLog.flush()` fa una `appendFileSync` **per evento** invece di un unico
batch. Sembra inefficiente ed è deliberato: su POSIX una `write` in `O_APPEND`
sotto i 4 KB è atomica, quindi due processi che scrivono sullo stesso file non
possono interlacciare una riga. Un batch di dimensione arbitraria perderebbe
quella garanzia proprio nello scenario cluster per cui esiste `instanceId`.

## 12. Perché `allow-loopback` è disattivata di default

In produzione è utile: health check e cron arrivano dalla macchina stessa.

Ma in **sviluppo** tutto il traffico è loopback. Con la regola attiva — e in cima,
dove first-match-wins la rende sovrana — sentinel appena installato non
osserverebbe nulla: si prova qualche URL strano, non compare niente nel log, e si
conclude che il plugin è rotto. Per un plugin il cui unico compito iniziale è
mostrarti il tuo traffico, è il peggior esordio possibile.

Emerso provando il plugin sul server reale, non ragionandoci sopra.

## 13. Mappa dei file

| File | Ruolo |
|---|---|
| `main.js` | ciclo di vita, motore, oggetto condiviso |
| `lib/requestFingerprint.js` | impronta passiva e sua decomposizione |
| `lib/ruleMatcher.js` | soggetto + valutazione delle condizioni |
| `lib/ruleValidator.js` | validazione **e** compilazione (regex precompilate) |
| `lib/ipMatcher.js` | CIDR IPv4/IPv6, con normalizzazione degli IPv4-mapped |
| `lib/boundedStore.js` | mappa con tetto, TTL e sfratto LRU |
| `lib/census.js` | censimento impronte + aggregato esiti |
| `lib/sentinelLog.js` | JSONL, rotazione, retention, tetto di dimensione |
| `lib/ruleHitCounter.js` | contatori per regola (base della promozione) |

Nel core: `createSentinelGate` in `core/priorityMiddlewares/runtimeGate.js`,
montaggio in `priorityMiddlewares.js`, iniezione del motore in `index.js`,
comandi in `core/cliBridge/{handlers,stateFile}.js` e `bin/ital8cms-cli.js`.

## 14. Una trappola nota per chi svilupperà qui

`ctx.ip` in ascolto dual-stack (la configurazione di default) restituisce
`::ffff:151.38.1.1`, non `151.38.1.1`. Un matcher CIDR che non normalizza fallisce
il confronto con `151.38.0.0/16`, e **una allowlist che non funziona è peggio di
una allowlist assente**. `ipMatcher.normalizeIp` esiste per questo, ed è coperto
dai test.
