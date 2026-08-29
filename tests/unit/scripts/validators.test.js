// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Test per scripts/lib/validators.js — il cancello d'ingresso del wizard.
 *
 * PERCHÉ QUESTO MODULO
 * --------------------
 * Sono funzioni pure, ma non sono un dettaglio: ogni valore che una persona digita
 * durante `npm run start-configure` passa di qui prima di finire in
 * `ital8Config.json5` o in `userAccount.json5`. In particolare `password()` è la
 * **policy dell'account root** — l'utente più privilegiato del sistema, creato al
 * primo avvio da `plugins/adminUsers/scripts/init.js`. Il file era allo 0%.
 *
 * QUALI VALIDATORI SONO VIVI (censito, non assunto)
 * ------------------------------------------------
 * | validatore | dove è cablato |
 * |---|---|
 * | `port` | `httpPort` (configWizard) |
 * | `apiPrefix` | `apiPrefix` **e** `adminPrefix` (configWizard) |
 * | `required` | `activeTheme` e `adminActiveTheme` (configWizard) |
 * | `username` / `email` / `password` | account **root** (adminUsers/scripts/init.js) |
 * | `boolean` `toBoolean` `positiveInteger` `directoryPath` | **nessuno** |
 *
 * I quattro senza chiamanti sono testati lo stesso — restano esportati e qualcuno
 * potrà cablarli — ma la loro sezione dice a chiare lettere che oggi sono codice
 * morto, perché è il fatto che cambia la gravità di ciò che vi si trova dentro.
 *
 * CONVENZIONE DEL MODULO
 * ----------------------
 * `true` = accettato; qualsiasi **stringa** = messaggio di rifiuto. È la forma che
 * `inquirer` si aspetta da `validate`, e per questo i test asseriscono `=== true`
 * e non la sola verità: un ritorno `'errore'` è truthy, quindi `toBeTruthy()`
 * accetterebbe silenziosamente un rifiuto.
 */

const validators = require('../../../scripts/lib/validators');

/** Accettato = esattamente `true`, mai un valore genericamente truthy. */
const accetta = (esito) => expect(esito).toBe(true);

/** Rifiutato = una stringa non vuota, che inquirer mostra alla persona. */
const rifiuta = (esito) => {
  expect(typeof esito).toBe('string');
  expect(esito.length).toBeGreaterThan(0);
};

describe('port() — la porta HTTP del server', () => {
  test.each(['1', '80', '3000', '65535'])('accetta la porta valida %s', (valore) => {
    accetta(validators.port(valore));
  });

  test.each([
    ['zero non è una porta', '0'],
    ['fuori dal range a 16 bit', '65536'],
    ['negativa', '-1'],
    ['non numerica', 'abc'],
    ['con lettere in coda', '3000abc'],
    ['stringa vuota', ''],
  ])('rifiuta %s', (_caso, valore) => {
    rifiuta(validators.port(valore));
  });

  test('i due rifiuti dicono cose DIVERSE', () => {
    // « non è un numero » e « fuori range » sono problemi diversi e vanno
    // distinti, altrimenti chi digita non sa cosa correggere.
    expect(validators.port('abc')).not.toBe(validators.port('99999'));
  });

  describe('un input che parseInt troncherebbe viene RIFIUTATO (D4, v3.15.0)', () => {
    // ERA UNA CARATTERIZZAZIONE, ora è il contratto.
    //
    // `port` faceva `parseInt(value)` e controllava solo il risultato: parseInt
    // si ferma al primo carattere non numerico invece di rifiutare, quindi
    // "3000abc" valeva 3000. Il wizard ha poi `filter: (v) => parseInt(v)`, che
    // scriveva il valore troncato in `ital8Config.json5`: la porta nel config
    // NON era quella digitata, e nessuno lo segnalava.
    //
    // Il maintainer ha scelto di rifiutare ciò che non è tutto cifre, così il
    // wizard richiede l'input invece di inventarsi un numero.

    test.each([
      ['lettere in coda',      '3000abc', 3000],
      ['un decimale',          '3000.9',  3000],
      ['notazione scientifica', '1e4',    1],
      ['un segno più',         '+3000',   3000],
    ])('rifiuta %s', (_caso, valore) => {
      rifiuta(validators.port(valore));
    });

    test('il messaggio mostra il valore in cui SAREBBE stato troncato', () => {
      // È la parte che rende il rifiuto istruttivo invece che pedante: `1e4` uno
      // lo legge come diecimila, e parseInt lo avrebbe reso 1.
      expect(validators.port('1e4')).toContain('1e4');
      expect(validators.port('1e4')).toMatch(/sarebbe diventato 1\b/);
      expect(validators.port('3000abc')).toMatch(/sarebbe diventato 3000\b/);
    });

    test('la frase sul troncamento NON compare se non c\'era nulla di silenzioso', () => {
      // Su `-1` parseInt restituisce -1: niente è stato scartato di nascosto, e
      // il vecchio codice l'avrebbe comunque respinto per il range. Annunciare
      // « sarebbe diventato -1 » spaventerebbe per un pericolo che non c'era.
      expect(validators.port('-1')).not.toMatch(/sarebbe diventato/);
      expect(validators.port('abc')).not.toMatch(/sarebbe diventato/);
    });

    test('gli spazi ai bordi restano tollerati', () => {
      // Chi digita uno spazio di troppo non ha sbagliato il numero. Il guard
      // deve mordere sul contenuto, non sulla battitura.
      accetta(validators.port('  3000  '));
      accetta(validators.port(' 80'));
    });

    test('un numero, non solo una stringa, resta accettato', () => {
      // Il wizard passa `currentConfig.httpPort` come `default`: se l'utente
      // preme invio, il validatore può ricevere un number. Rifiutarlo bloccherebbe
      // il percorso più frequente di tutti.
      accetta(validators.port(3000));
    });

    test('il range continua a essere controllato DOPO il formato', () => {
      // I due rifiuti restano distinti: « formato » e « fuori range » sono
      // problemi diversi e chi digita deve sapere quale dei due ha davanti.
      expect(validators.port('65536')).toMatch(/tra 1 e 65535/);
      expect(validators.port('0')).toMatch(/tra 1 e 65535/);
      expect(validators.port('3000abc')).not.toMatch(/tra 1 e 65535/);
    });
  });

  test('l\'ordine filter/validate di inquirer regge il guard', () => {
    // La premessa del contratto qui sopra. Il guard funziona solo se `validate`
    // riceve la stringa GREZZA: se `filter: parseInt` girasse prima, il
    // validatore vedrebbe già 3000 e /^\d+$/ passerebbe, riaprendo il difetto
    // senza che nessun altro test se ne accorga.
    //
    // Verificato sul sorgente di inquirer 14 invece che assunto: il filtro è
    // applicato nel `.then()` DOPO che il prompt ha risolto.
    const fs = require('fs');
    const path = require('path');
    const sorgente = fs.readFileSync(
      path.join(__dirname, '../../../node_modules/inquirer/dist/ui/prompt.js'), 'utf8');

    expect(sorgente).toMatch(/promptFn\(question[\s\S]{0,200}?answer:\s*filter\(answer/);
  });
});

describe('password() — la policy dell\'account ROOT', () => {
  // È il punto più delicato del file: questa funzione decide quale password
  // protegge l'utente più privilegiato del CMS, scelta una volta sola al primo
  // avvio. Ogni requisito è verificato in ISOLAMENTO — una password che manca di
  // una cosa sola — altrimenti un test che passa non dice quale regola ha agito.
  test('accetta una password che soddisfa tutti i requisiti', () => {
    accetta(validators.password('Password1'));
  });

  test.each([
    ['manca SOLO la maiuscola', 'password1'],
    ['manca SOLO la minuscola', 'PASSWORD1'],
    ['manca SOLO la cifra',     'PasswordX'],
    ['è SOLO troppo corta',     'Pass1'],
  ])('rifiuta quando %s', (_caso, valore) => {
    rifiuta(validators.password(valore));
  });

  test.each([['vuota', ''], ['soli spazi', '   '], ['undefined', undefined]])(
    'rifiuta la password %s',
    (_caso, valore) => rifiuta(validators.password(valore)),
  );

  test('la soglia di lunghezza è esattamente 8: 7 no, 8 sì', () => {
    // Il confine si asserisce da entrambi i lati, altrimenti un `<` diventato
    // `<=` passerebbe inosservato.
    rifiuta(validators.password('Passwo1'));  // 7
    accetta(validators.password('Passwor1')); // 8
  });

  test('ogni requisito mancante ha un messaggio PROPRIO', () => {
    // Quattro rifiuti distinti: chi installa deve sapere cosa aggiungere, non
    // ricevere quattro volte « password non valida ».
    const messaggi = new Set([
      validators.password('password1'),
      validators.password('PASSWORD1'),
      validators.password('PasswordX'),
      validators.password('Pass1'),
    ]);
    expect(messaggi.size).toBe(4);
  });

  test('nessun messaggio di rifiuto contiene la password digitata', () => {
    // I messaggi finiscono a schermo e nel logger, che scrive su file: un
    // rifiuto che cita il valore trascriverebbe un tentativo di password —
    // spesso una variante di quella vera — in un file di log.
    // Si usano solo input RIFIUTATI: su una password valida il ritorno è `true`,
    // e non c'è messaggio in cui qualcosa possa trapelare.
    for (const respinta of ['quasiGiusta', 'CORTA1', 'senzacifre', 'abc']) {
      const messaggio = validators.password(respinta);
      expect(typeof messaggio).toBe('string');
      expect(messaggio).not.toContain(respinta);
    }
  });

  test('non impone un tetto di lunghezza né vieta i simboli', () => {
    // Una passphrase lunga è più forte, non più debole: bocciarla sarebbe un
    // difetto. Vale la pena fissarlo, perché è la classica regola aggiunta
    // "per sicurezza" che la riduce.
    accetta(validators.password('A1' + 'b'.repeat(200)));
    accetta(validators.password('Passw0rd!@#$%^&*()'));
  });
});

describe('username() — l\'account root', () => {
  test.each(['admin', 'abc', 'user_name', 'user-name', 'Root123'])(
    'accetta %s',
    (valore) => accetta(validators.username(valore)),
  );

  test.each([
    ['vuoto',              ''],
    ['soli spazi',         '   '],
    ['troppo corto (2)',   'ab'],
    ['con spazio interno', 'user name'],
    ['con punto',          'user.name'],
    ['con chiocciola',     'user@host'],
  ])('rifiuta lo username %s', (_caso, valore) => rifiuta(validators.username(valore)));

  test('la soglia è esattamente 3: 2 no, 3 sì', () => {
    rifiuta(validators.username('ab'));
    accetta(validators.username('abc'));
  });

  test('⚠ underscore e trattino NON vengono respinti', () => {
    // Test a specchio: una regex troppo stretta è un difetto quanto una troppo
    // larga, e questo è il caso che si rompe per primo restringendola.
    accetta(validators.username('_'.repeat(3)));
    accetta(validators.username('a-b'));
  });

  test('⚠ CARATTERIZZAZIONE: uno username di soli spazi con del testo passa il trim', () => {
    // `value.trim() === ''` scarta i soli spazi, ma la lunghezza è misurata su
    // `value` NON trimmato: ' a ' ha length 3 e supera la soglia, poi però la
    // regex lo boccia per via degli spazi. Il rifiuto arriva, con il messaggio
    // dei caratteri e non quello della lunghezza.
    expect(validators.username(' a ')).toMatch(/caratteri|lettere|numeri/i);
  });
});

describe('email() — l\'account root', () => {
  test.each(['a@b.co', 'nome.cognome@esempio.it', 'x+tag@dominio.org'])(
    'accetta %s',
    (valore) => accetta(validators.email(valore)),
  );

  test.each([
    ['vuota',            ''],
    ['soli spazi',       '   '],
    ['senza chiocciola', 'nondominio.it'],
    ['senza dominio',    'nome@'],
    ['senza punto',      'nome@dominio'],
    ['con spazio',       'nome @dominio.it'],
    ['due chiocciole',   'a@b@c.it'],
  ])('rifiuta l\'email %s', (_caso, valore) => rifiuta(validators.email(valore)));

  test('gli spazi attorno non vengono tollerati', () => {
    // Il `trim()` serve solo a distinguere « vuota » da « malformata »: il
    // controllo vero gira sul valore grezzo, quindi ' a@b.co ' è rifiutato.
    rifiuta(validators.email(' a@b.co '));
  });
});

describe('apiPrefix() — apiPrefix e adminPrefix', () => {
  test.each(['api', 'admin', 'v1', 'my-api', 'my_api'])(
    'accetta %s',
    (valore) => accetta(validators.apiPrefix(valore)),
  );

  test.each([
    ['vuoto',      ''],
    ['con slash',  'api/v1'],
    ['con spazio', 'my api'],
    ['con punto',  'api.v1'],
  ])('rifiuta il prefisso %s', (_caso, valore) => rifiuta(validators.apiPrefix(valore)));

  test('⚠ il controllo esplicito sullo slash è irraggiungibile', () => {
    // Il codice fa, in quest'ordine:
    //   1. `if (!/^[a-zA-Z0-9_-]+$/.test(value)) return '…solo lettere, numeri…'`
    //   2. `if (value.includes('/')) return 'Prefix non può contenere slash (/)'`
    // La regex non ammette `/`, quindi ogni valore con uno slash esce già al
    // punto 1 e il messaggio dedicato del punto 2 non viene MAI mostrato. Non è
    // un buco — il rifiuto avviene comunque — ma è un ramo morto, e il messaggio
    // più utile dei due è quello che nessuno leggerà.
    expect(validators.apiPrefix('api/v1')).not.toMatch(/slash/i);
  });
});

describe('required() — activeTheme e adminActiveTheme', () => {
  test('accetta una stringa con contenuto', () => {
    accetta(validators.required('default'));
  });

  test.each([['vuota', ''], ['soli spazi', '   '], ['tab e a capo', '\t\n']])(
    'rifiuta la stringa %s',
    (_caso, valore) => rifiuta(validators.required(valore)),
  );

  test('NON verifica che il tema esista davvero', () => {
    // Contratto onesto: `required` guarda solo che qualcosa sia stato scritto.
    // Un tema inesistente passa qui e viene intercettato al boot da `themeSys`.
    // Fissarlo evita che qualcuno dia per scontata una verifica che non c'è.
    accetta(validators.required('temaCheNonEsiste'));
  });
});

describe('i quattro validatori SENZA chiamanti', () => {
  // Censito su tutto il repo: `boolean`, `toBoolean`, `positiveInteger` e
  // `directoryPath` non sono cablati da nessuna parte. Restano esportati, quindi
  // si testano; ma il fatto che siano morti cambia la gravità di ciò che
  // contengono, e va detto qui e non lasciato dedurre.

  describe('boolean() e toBoolean()', () => {
    test.each(['true', 'false', 'yes', 'no', '1', '0'])('accetta %s', (valore) => {
      accetta(validators.boolean(valore));
    });

    test('il confronto è insensibile al maiuscolo', () => {
      accetta(validators.boolean('TRUE'));
      accetta(validators.boolean('Yes'));
    });

    test.each(['si', 'vero', 'on', '2', ''])('rifiuta %s', (valore) => {
      rifiuta(validators.boolean(valore));
    });

    test('toBoolean() converte le tre forme affermative, e nient\'altro', () => {
      for (const v of ['true', 'yes', '1', 'TRUE', 'Yes']) expect(validators.toBoolean(v)).toBe(true);
      for (const v of ['false', 'no', '0', 'qualsiasi', '']) expect(validators.toBoolean(v)).toBe(false);
    });

    test('toBoolean() restituisce SEMPRE un booleano, mai la stringa', () => {
      // Finirebbe in un `.json5`: un `"false"` stringa è truthy e capovolgerebbe
      // il significato della chiave.
      expect(typeof validators.toBoolean('qualsiasi')).toBe('boolean');
    });
  });

  describe('positiveInteger()', () => {
    test('accetta i numeri non negativi', () => {
      accetta(validators.positiveInteger('5'));
      accetta(validators.positiveInteger('0'));
    });

    test('rifiuta i negativi e il non numerico', () => {
      rifiuta(validators.positiveInteger('-1'));
      rifiuta(validators.positiveInteger('abc'));
    });

    test('⚠ il nome e il messaggio dicono « positivo », ma 0 è accettato', () => {
      // Accettare 0 è quasi certamente voluto (0 = « disattivato » in mezzo
      // schema del progetto: `retentionDays`, `debugMode`, `hitCounterFlushInterval`).
      // È il MESSAGGIO a essere impreciso, non il comportamento — e il messaggio
      // si vede solo rifiutando, cioè mai per 0.
      accetta(validators.positiveInteger('0'));
      expect(validators.positiveInteger('-1')).toMatch(/positivo/i);
    });

    test('un decimale viene RIFIUTATO, non troncato (D4, v3.15.0)', () => {
      // Stesso difetto di `port()`, chiuso insieme al suo. Questo validatore non
      // ha chiamanti nel repo — vedi il censimento più sopra — quindi la
      // correzione non cambia nulla oggi: serve a non lasciare in piedi la
      // stessa trappola per il primo che lo userà.
      rifiuta(validators.positiveInteger('3.7'));
      rifiuta(validators.positiveInteger('5xyz'));
      expect(validators.positiveInteger('3.7')).toMatch(/sarebbe diventato 3\b/);
    });

    test('il « non positivo » resta un messaggio SUO, distinto dal formato', () => {
      // Chi scrive « -1 » ha capito il formato e sbagliato il valore: è un'altra
      // cosa, e riceverne il messaggio sbagliato manda a correggere il posto
      // sbagliato.
      expect(validators.positiveInteger('-1')).toMatch(/positivo/i);
      expect(validators.positiveInteger('-1')).not.toMatch(/solo cifre/);
    });
  });

  describe('directoryPath()', () => {
    test('accetta un path assoluto ordinario', () => {
      accetta(validators.directoryPath('/var/www/html'));
    });

    test.each([
      ['vuoto',           ''],
      ['con spazi',       'con spazi'],
      ['con punto e virgola', 'a;rm -rf /'],
      ['con backtick',    'a`whoami`'],
      ['con $',           '$HOME/x'],
    ])('rifiuta il path %s', (_caso, valore) => rifiuta(validators.directoryPath(valore)));

    test('⚠ i `..` di traversal sono ACCETTATI — ma la funzione è codice morto', () => {
      // La regex ammette punti e slash, quindi `../../etc/passwd` passa.
      // NON è una vulnerabilità viva: `directoryPath` non è cablata in nessun
      // punto del repo, quindi nessun input utente la attraversa oggi. Il test
      // esiste perché il giorno in cui qualcuno la userà per un path di config,
      // questa riga è ciò che glielo dirà — invece di scoprirlo dopo.
      accetta(validators.directoryPath('../../etc/passwd'));
      accetta(validators.directoryPath('..'));
    });
  });
});

describe('la forma del contratto, uguale per tutti', () => {
  const NOMI = [
    'port', 'boolean', 'toBoolean', 'email', 'username',
    'password', 'required', 'positiveInteger', 'directoryPath', 'apiPrefix',
  ];

  test('il modulo esporta esattamente i dieci validatori attesi', () => {
    // Se qualcuno ne aggiunge uno, questo test lo fa notare: va censito e
    // testato, non aggiunto in silenzio.
    expect(Object.keys(validators).sort()).toEqual([...NOMI].sort());
  });

  test.each(NOMI.filter((n) => n !== 'toBoolean'))(
    '%s() restituisce `true` oppure una STRINGA, mai false',
    (nome) => {
      // `inquirer` mostra il valore di ritorno quando non è `true`: un `false`
      // secco produrrebbe un rifiuto senza spiegazione.
      for (const input of ['', '   ', 'x', '0', 'ValoreQualsiasi1']) {
        const esito = validators[nome](input);
        expect(esito === true || typeof esito === 'string').toBe(true);
        expect(esito).not.toBe(false);
      }
    },
  );

  test.each(NOMI.filter((n) => n !== 'toBoolean'))(
    '%s() non lancia su undefined e null',
    (nome) => {
      // Il wizard può invocare `validate` prima che sia stato digitato qualcosa:
      // un throw qui interrompe l'installazione con uno stack trace.
      for (const input of [undefined, null]) {
        expect(() => validators[nome](input)).not.toThrow();
      }
    },
  );
});
