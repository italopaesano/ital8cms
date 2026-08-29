// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Test per plugins/adminUsers/roleManagement.js — i ruoli custom.
 *
 * PERCHÉ
 * ------
 * I ruoli sono ciò che `adminAccessControl` confronta per decidere chi entra dove.
 * Il modulo era al 28,5% di funzioni, e il controllo più importante — **un ruolo
 * di sistema non si tocca** — non era verificato da nessuna parte: se
 * `isHardcoded` smettesse di essere onorato, si potrebbe rinominare `admin` o
 * cancellare `root` dal pannello, e nessun test se ne accorgerebbe.
 *
 * ISOLAMENTO — LEGGERE PRIMA DI AGGIUNGERE CASI
 * --------------------------------------------
 * `rolesFilePath` e `usersFilePath` sono cablati su `__dirname`: il modulo scrive
 * sui file VERI. Questi test esercitano solo i rami che ritornano PRIMA di ogni
 * scrittura — cosa che l'ordine del codice garantisce, perché sia
 * `updateCustomRole()` sia `deleteCustomRole()` respingono i ruoli hardcoded e
 * quelli inesistenti prima di arrivare a `fs.writeFileSync`.
 *
 * Come nel gemello su `userManagement`, la promessa non è affidata alla lettura
 * del codice: un `afterAll` confronta l'hash dei file di dati con quello
 * fotografato all'inizio. Coprire i rami che scrivono richiede un path
 * iniettabile (TODO.md §5).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  createCustomRole,
  updateCustomRole,
  deleteCustomRole,
  getCustomRoles,
  getHardcodedRoles,
  getNextCustomRoleId,
  isRoleIdAbsent,
} = require('../../roleManagement');

const PLUGIN_DIR = path.join(__dirname, '..', '..');
const DATA_FILES = [
  path.join(PLUGIN_DIR, 'userRole.json5'),
  path.join(PLUGIN_DIR, 'userAccount.json5'),
];

const digest = (file) => (fs.existsSync(file)
  ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  : 'ASSENTE');

let dataDigests = null;

beforeAll(() => { dataDigests = DATA_FILES.map(digest); });

afterAll(() => {
  DATA_FILES.forEach((file, i) => {
    expect({ file: path.basename(file), digest: digest(file) })
      .toEqual({ file: path.basename(file), digest: dataDigests[i] });
  });
});

// I quattro ruoli di sistema, per ID. Sono un contratto dichiarato in CLAUDE.md,
// non un dato di configurazione: 0 root, 1 admin, 2 editor, 3 selfEditor.
const HARDCODED_IDS = [0, 1, 2, 3];

describe('createCustomRole() — validazione', () => {
  test.each([
    ['nome mancante',        [undefined, 'descrizione']],
    ['descrizione mancante', ['nomeRuolo', undefined]],
    ['entrambi mancanti',    [undefined, undefined]],
    ['nome vuoto',           ['', 'descrizione']],
  ])('%s → errore con errorType "all"', async (_caso, args) => {
    const res = createCustomRole(...args);
    expect(res.errorType).toBe('all');
    expect(res.roleId).toBeUndefined();
  });

  test.each([
    ['spazio',      'ruolo rotto'],
    ['punto',       'ruolo.rotto'],
    ['chiocciola',  'ruolo@rotto'],
    ['accento',     'ruolò'],
  ])('carattere non ammesso (%s) → rifiutato', async (_caso, name) => {
    const res = createCustomRole(name, 'descrizione valida');
    expect(res.errorType).toBe('name');
  });

  test('nome più corto di 3 caratteri → rifiutato', () => {
    const res = createCustomRole('ab', 'descrizione valida');
    expect(res.errorType).toBe('name');
    expect(res.error).toMatch(/3/);
  });
});

describe('i file di DATI non portano commenti — è una scelta, non una svista', () => {
  // DECISIONE del maintainer (v3.21.0), speculare a D1.
  //
  // `writeJson5Atomic` riserializza con `JSON.stringify`, quindi ogni scrittura
  // azzera i commenti del file vivo. Per i CONFIG il progetto ha scelto l'opposto
  // — scrittura chirurgica, D1 — ma `userRole.json5` e `userAccount.json5` sono
  // **dati**: li scrive il codice, non una persona, e comportano cancellazioni di
  // chiavi annidate che una scrittura chirurgica non saprebbe fare.
  //
  // Questi test impediscono che qualcuno "corregga" l'incoerenza in una direzione
  // sola, lasciando il progetto a metà strada.

  test('i .default dei file di dati NON portano l\'intestazione JSON5', () => {
    // Se la riportasse, la copia viva la perderebbe alla prima modifica di un
    // ruolo — cioè si tornerebbe alla contraddizione che questa decisione chiude.
    for (const nome of ['userRole.default.json5', 'userAccount.default.json5']) {
      const testo = fs.readFileSync(path.join(__dirname, '../..', nome), 'utf8');
      expect(testo).not.toMatch(/^\/\/ This file follows the JSON5 standard/);
      // Ma dichiarano perché: un file senza intestazione e senza spiegazione
      // sembrerebbe una dimenticanza.
      expect(testo).toMatch(/FILE DI DATI, NON DI CONFIGURAZIONE/);
    }
  });

  test('i .default restano JSON5 validi e leggibili da loadJson5', () => {
    const loadJson5 = require('../../../../core/loadJson5');

    expect(Object.keys(loadJson5(path.join(__dirname, '../../userRole.default.json5')).roles))
      .toEqual(['0', '1', '2', '3']);
    expect(loadJson5(path.join(__dirname, '../../userAccount.default.json5')).users).toEqual({});
  });

  test('la decisione è scritta accanto al codice che la applica', () => {
    // Un comportamento voluto che sembra un difetto va dichiarato dove qualcuno
    // lo incontrerà: nella funzione che riserializza.
    const sorgente = fs.readFileSync(path.join(__dirname, '../../roleManagement.js'), 'utf8');
    const jsdoc = sorgente.slice(0, sorgente.indexOf('function writeJson5Atomic'));

    expect(jsdoc).toMatch(/PERCHÉ RISERIALIZZA, ED È VOLUTO/);
    expect(jsdoc).toMatch(/dati.*non.*configurazione|dati\*\*, non configurazione/is);
  });
});

describe('updateCustomRole() — i ruoli di sistema sono immutabili', () => {
  // Il controllo che conta. Se cadesse, dal pannello si potrebbe rinominare
  // `admin` e le regole di accesso che lo nominano smetterebbero di combaciare.
  test.each(HARDCODED_IDS)('ruolo hardcoded %i → modifica rifiutata', (roleId) => {
    const res = updateCustomRole(roleId, 'nomeNuovo', 'descrizione nuova');
    expect(res.error).toBeDefined();
    expect(res.success).toBeUndefined();
  });

  test('il messaggio dice PERCHÉ, non solo che è vietato', () => {
    const res = updateCustomRole(1, 'nomeNuovo', 'descrizione nuova');
    expect(res.error).toMatch(/sistema|hardcoded/i);
  });

  test('il messaggio NOMINA il ruolo toccato (D5, v3.17.0)', () => {
    // Prima diceva soltanto « non puoi modificare un ruolo di sistema »: vero,
    // ma chi lo leggeva sapeva solo di aver sbattuto contro un muro, senza
    // sapere contro quale.
    const res = updateCustomRole(1, 'nomeNuovo', 'descrizione nuova');
    expect(res.error).toContain('"admin"');
    expect(res.error).toContain('ID 1');
  });

  test('il messaggio dice cosa fare INVECE', () => {
    // È la differenza fra un rifiuto e un vicolo cieco: chi voleva un ruolo su
    // misura deve uscire dall'errore sapendo dove andare.
    const res = updateCustomRole(1, 'nomeNuovo', 'descrizione nuova');
    expect(res.error).toMatch(/custom/i);
    expect(res.error).toMatch(/100/);
  });

  test('il gergo « hardcoded » non arriva più all\'amministratore', () => {
    // Resta il nome del campo nello schema, dove è codice; nel messaggio non
    // aggiungeva nulla a « di sistema ».
    expect(updateCustomRole(1, 'nomeNuovo', 'desc').error).not.toMatch(/hardcoded/i);
  });

  test('l\'azione tentata viaggia a parte, non dentro il testo', () => {
    // Il testo spiega la REGOLA ed è identico per modifica ed eliminazione;
    // quale delle due sia stata tentata è informazione separata, così
    // l'interfaccia può mostrarla dove vuole senza due varianti del messaggio.
    expect(updateCustomRole(1, 'nomeNuovo', 'desc').refusedAction).toBe('modifica');
    expect(deleteCustomRole(1).refusedAction).toBe('eliminazione');
  });

  test('UN SOLO messaggio per modifica ed eliminazione', () => {
    // Se un domani i due testi divergessero, questo test lo direbbe: due
    // formulazioni della stessa regola fanno cercare una differenza che non c'è.
    expect(updateCustomRole(2, 'nomeNuovo', 'desc').error).toBe(deleteCustomRole(2).error);
  });

  test('ruolo inesistente → errore con errorType "roleId"', () => {
    const res = updateCustomRole(99999, 'nomeNuovo', 'descrizione nuova');
    expect(res.errorType).toBe('roleId');
    expect(res.error).toMatch(/non trovato/);
  });

  test.each([
    ['roleId mancante', [undefined, 'nome', 'descrizione']],
    ['nome mancante',   [100, undefined, 'descrizione']],
  ])('%s → errore con errorType "all"', (_caso, args) => {
    expect(updateCustomRole(...args).errorType).toBe('all');
  });
});

describe('deleteCustomRole() — i ruoli di sistema non si cancellano', () => {
  test.each(HARDCODED_IDS)('ruolo hardcoded %i → cancellazione rifiutata', (roleId) => {
    const res = deleteCustomRole(roleId);
    expect(res.error).toBeDefined();
    expect(res.success).toBeUndefined();
    // `affectedUsers` compare solo sul percorso riuscito: se ci fosse, vorrebbe
    // dire che la cancellazione è stata eseguita.
    expect(res.affectedUsers).toBeUndefined();
  });

  test('il messaggio dice PERCHÉ', () => {
    expect(deleteCustomRole(1).error).toMatch(/sistema|hardcoded/i);
  });

  test.each([[0, 'root'], [1, 'admin'], [2, 'editor'], [3, 'selfEditor']])(
    'il ruolo %i è nominato per NOME nel messaggio', (roleId, nome) => {
      // Su `root` conta più che altrove: è il rifiuto che un amministratore
      // deve capire al primo colpo, senza andare a cercare che cos'è l'ID 0.
      expect(deleteCustomRole(roleId).error).toContain(`"${nome}"`);
    });

  test('`isHardcoded` resta il guardiano UNICO (D5)', () => {
    // Decisione del maintainer: nessun floor `roleId >= 100` come secondo
    // strato. Due fonti di verità sullo stesso confine divergono prima o poi,
    // e questo flag è ciò che lo schema dei ruoli dichiara.
    const sorgente = require('fs').readFileSync(
      require('path').join(__dirname, '../../roleManagement.js'), 'utf8');

    const guardiaUpdate = sorgente.slice(sorgente.indexOf('function updateCustomRole'));
    const guardiaDelete = sorgente.slice(sorgente.indexOf('function deleteCustomRole'));
    expect(guardiaUpdate).toMatch(/isHardcoded/);
    expect(guardiaDelete).toMatch(/isHardcoded/);
  });

  // Il numero 0 è l'ID di `root`, il ruolo più privilegiato — ed era scambiato
  // per un argomento assente da `if (!roleId)`. Corretto in v3.4.0: il rifiuto
  // avveniva comunque, ma il messaggio mentiva e su update evidenziava il campo
  // sbagliato nel form.
  test('il numero 0 è riconosciuto come roleId, non come argomento assente', () => {
    const res = updateCustomRole(0, 'nomeNuovo', 'descrizione');
    expect(res.errorType).toBe('roleId');
    expect(res.error).toMatch(/sistema|hardcoded/i);
    expect(res.error).not.toMatch(/Devi specificare/);
  });

  test('`0` e `"0"` prendono ora lo STESSO ramo', () => {
    // La divergenza fra i due era la prova che si trattava di un errore di
    // controllo e non di una scelta: ora devono convergere.
    expect(deleteCustomRole(0).error).toBe(deleteCustomRole('0').error);
    expect(deleteCustomRole(0).errorType).toBe('roleId');
    expect(deleteCustomRole(0).error).toMatch(/sistema|hardcoded/i);
  });

  test.each([
    ['undefined', undefined],
    ['null',      null],
    ['stringa vuota', ''],
  ])('un roleId davvero assente (%s) resta rifiutato come tale', (_caso, valore) => {
    // La correzione non deve aver allargato la porta: ciò che è assente per
    // davvero deve continuare a produrre il messaggio « devi specificare ».
    expect(deleteCustomRole(valore).error).toMatch(/Devi specificare/);
    expect(updateCustomRole(valore, 'nomeX', 'descX').errorType).toBe('all');
  });

  test('isRoleIdAbsent() — contratto della funzione', () => {
    expect(isRoleIdAbsent(undefined)).toBe(true);
    expect(isRoleIdAbsent(null)).toBe(true);
    expect(isRoleIdAbsent('')).toBe(true);
    // 0 è un ID valido, non un'assenza. È il cuore della correzione.
    expect(isRoleIdAbsent(0)).toBe(false);
    expect(isRoleIdAbsent('0')).toBe(false);
    expect(isRoleIdAbsent(100)).toBe(false);
  });

  test('ruolo inesistente → errore, nessun utente toccato', () => {
    const res = deleteCustomRole(99999);
    expect(res.errorType).toBe('roleId');
    expect(res.affectedUsers).toBeUndefined();
  });

  test('roleId mancante → rifiutato', () => {
    expect(deleteCustomRole(undefined).errorType).toBe('roleId');
  });
});

describe('le due regole sul nome valgono su ENTRAMBI gli ingressi', () => {
  // `createCustomRole` e `updateCustomRole` scrivono lo stesso campo, quindi
  // devono concordare su cosa sia valido. La lunghezza minima mancava su update:
  // creare un ruolo "ab" era rifiutato, ma crearne uno "moderator" e poi
  // rinominarlo in "a" passava. Allineato in v3.12.0.
  //
  // Il ramo di validazione del nome in `updateCustomRole` è raggiungibile SOLO per
  // un ruolo custom esistente — i controlli su esistenza e `isHardcoded` vengono
  // prima — e questa installazione non ne ha. Qui si verifica quindi ciò che è
  // verificabile senza scrivere: che le due funzioni applichino la stessa soglia e
  // diano lo STESSO messaggio.
  test.each([['una lettera', 'a'], ['due lettere', 'ab']])(
    'createCustomRole rifiuta un nome di %s',
    (_caso, nome) => {
      expect(createCustomRole(nome, 'descrizione').error).toMatch(/almeno 3 caratteri/);
    },
  );

  test('le due funzioni usano la STESSA soglia e lo STESSO messaggio', () => {
    // Letto dal sorgente: il ramo di update non è eseguibile qui, ma la sua
    // divergenza dal ramo di create è esattamente il difetto da presidiare.
    const sorgente = fs.readFileSync(
      path.join(__dirname, '../../roleManagement.js'), 'utf8');

    const occorrenze = sorgente.match(/name\.length < 3/g) || [];
    const messaggi = sorgente.match(/deve essere di almeno 3 caratteri/g) || [];

    // Due funzioni, due controlli, due messaggi identici.
    expect({ controlli: occorrenze.length, messaggi: messaggi.length })
      .toEqual({ controlli: 2, messaggi: 2 });
  });
});

describe('le scritture sono ATOMICHE (temp + rename)', () => {
  test('nessuna scrittura diretta sui due file di dati', () => {
    // Regola 1 di CLAUDE.md. Qui si riscrivono ruoli e account dell'intera
    // installazione: un writeFileSync interrotto a metà lascia un file TRONCATO, e
    // al boot successivo `loadJson5` non lo legge più — nessun utente, nessun
    // ruolo, pannello admin irraggiungibile.
    const sorgente = fs.readFileSync(
      path.join(__dirname, '../../roleManagement.js'), 'utf8');

    // L'unico writeFileSync ammesso è quello DENTRO l'helper atomico, che scrive
    // sul file temporaneo.
    const scrittureDirette = [...sorgente.matchAll(/fs\.writeFileSync\(([^,]+),/g)]
      .map((m) => m[1].trim())
      .filter((target) => !target.includes('tempPath'));

    expect(scrittureDirette).toEqual([]);
    expect(sorgente).toMatch(/fs\.renameSync\(tempPath/);
  });
});

describe('lettura dei ruoli', () => {
  test('getHardcodedRoles() restituisce i quattro ruoli di sistema', () => {
    const roles = getHardcodedRoles();
    const ids = roles.map((r) => parseInt(r.id, 10)).sort((a, b) => a - b);

    expect(ids).toEqual(HARDCODED_IDS);
    expect(roles.every((r) => r.isHardcoded === true)).toBe(true);
  });

  test('getCustomRoles() non restituisce mai un ruolo di sistema', () => {
    // Le due liste devono essere disgiunte: è la stessa distinzione su cui si
    // basa il divieto di modifica verificato sopra.
    const customIds = getCustomRoles().map((r) => parseInt(r.id, 10));
    for (const hardcodedId of HARDCODED_IDS) {
      expect(customIds).not.toContain(hardcodedId);
    }
    expect(getCustomRoles().every((r) => r.isHardcoded === false)).toBe(true);
  });

  test('getNextCustomRoleId() resta nello spazio riservato ai ruoli custom (>= 100)', () => {
    // Gli ID sotto 100 sono lo spazio dei ruoli di sistema: sconfinarci
    // sovrascriverebbe un ruolo hardcoded.
    const next = getNextCustomRoleId();
    expect(Number.isInteger(next)).toBe(true);
    expect(next).toBeGreaterThanOrEqual(100);
  });

  test('getNextCustomRoleId() non collide con un ruolo già esistente', () => {
    const next = getNextCustomRoleId();
    const existing = [...getCustomRoles(), ...getHardcodedRoles()].map((r) => parseInt(r.id, 10));
    expect(existing).not.toContain(next);
  });
});
