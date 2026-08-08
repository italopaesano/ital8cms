# decoys/ — contenuti fittizi serviti al posto di un errore

Questa cartella ospita i file usati dall'azione `decoy` di `sentinel`.

> **Stato: predisposizione.** L'azione `decoy` arriva nella v2 del plugin. La
> struttura di cartelle esiste già perché la distinzione fra file forniti e file
> personalizzati va decisa prima che qualcuno cominci a metterci roba dentro, non
> dopo il primo aggiornamento che gliela sovrascrive.

## Le due cartelle

```
decoys/
├── default/    ← forniti col plugin. VERSIONATI: un aggiornamento li sovrascrive.
└── data/       ← i tuoi. MAI toccati dagli aggiornamenti, esclusi da git.
```

Alla risoluzione di un decoy, `data/` ha la **precedenza** su `default/`: per
personalizzare un file fornito basta copiarlo in `data/` con lo stesso nome e
modificarlo lì. L'originale resta al suo posto e continua ad aggiornarsi.

È la stessa simmetria del ciclo di vita dei config del progetto — `x.default.json5`
è la fonte di verità versionata, `x.json5` è il vivo dell'utente e non sta in git.

## Cos'è un decoy

Letteralmente un'*esca*: l'anatra di legno che il cacciatore mette sull'acqua
perché quelle vere si posino accanto. Qui è **contenuto falso ma credibile,
servito al posto di un errore**, per far credere a chi bussa di aver trovato
quello che cercava.

Uno scanner chiede `/wp-login.php`. Tre risposte possibili:

| Risposta | Cosa impara chi ha bussato |
|---|---|
| `404` | «Non è WordPress.» Passa oltre. Gli è costato zero. |
| `403` | «Non è WordPress **e c'è un filtro attivo.** Vediamo cosa protegge.» Gli hai regalato un'informazione. |
| decoy | «È WordPress!» Lancia l'intera batteria di exploit WP contro un sito che PHP non lo esegue nemmeno. |

Il valore è **asimmetrico**: a te costa un file statico, a lui costa tempo reale.
E soprattutto **avvelena i suoi dati** — molti scanner alimentano database di
bersagli, e un decoy ci inserisce una voce falsa: il tuo sito viene classificato
male, e i tentativi successivi partono da premesse sbagliate.

Il secondo valore è che ti dice **chi è ostile con certezza**. Una richiesta a
`/wp-login.php` può essere un crawler distratto; ma chi *invia il form* del finto
login è deliberato al 100%. Il decoy trasforma il filtro da barriera passiva a
sensore.

## Regole per chi scrive un decoy

1. **Niente EJS, niente partial del tema.** I decoy sono file statici serviti
   fuori dalla pipeline di rendering. Due ragioni: non si espone il motore di
   template a un percorso raggiungibile da traffico ostile, e il markup del tema
   renderebbe il decoy riconoscibile a colpo d'occhio.
2. **Nessun contenuto reale.** Nessun nome utente vero, nessun path interno vero,
   nessuna versione vera del software.
3. **Coerenza con quello che imiti.** Un finto `wp-login.php` che non somiglia a
   un login WordPress non inganna nessuno e vale meno di un 404.
4. **Se ci metti credenziali fasulle** (canary token), ricordati di sorvegliare
   l'URL o l'account corrispondente con una regola trappola: il valore di un
   canary è tutto nel sapere quando qualcuno ci casca.

## Cosa non va messo qui

Contromisure attive — zip bomb e simili. Non sono difesa ma ritorsione: con un
falso positivo mandi in crash il browser di un utente reale, e in diversi
ordinamenti configurano danneggiamento di sistema informatico altrui. Vedi la
sezione dedicata in [`../TODO.md`](../TODO.md).
