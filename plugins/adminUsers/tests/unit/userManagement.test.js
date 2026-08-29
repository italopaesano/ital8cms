// Questo file segue lo standard del progetto ital8cms
'use strict';

/**
 * Test per plugins/adminUsers/userManagement.js — creazione e aggiornamento utenti.
 *
 * PERCHÉ
 * ------
 * `userUsert()` è il punto in cui nascono gli account: decide quali username sono
 * ammessi, quali email, e come viene hashata la password. Era a **0% di funzioni**
 * — mai invocata da nessun test — pur essendo la porta d'ingresso dell'unico
 * sistema di identità del CMS.
 *
 * ISOLAMENTO — LEGGERE PRIMA DI AGGIUNGERE CASI
 * --------------------------------------------
 * Il modulo scrive su `plugins/adminUsers/userAccount.json5`, cioè il file VERO
 * degli account: `usersFilePath` è cablato su `__dirname`. Questi test esercitano
 * quindi **soltanto** i rami che ritornano PRIMA di qualunque scrittura.
 *
 * L'ordine dentro `userUsert()` lo consente: tutte le validazioni precedono sia
 * `bcryptjs.hash()` sia `loadJson5(usersFilePath)`. Un solo caso arriva a LEGGERE
 * il file (utente inesistente con `isNewUser: false`) e ritorna comunque prima di
 * scrivere.
 *
 * La promessa non è affidata alla lettura del codice: un `afterAll` confronta
 * l'hash dei due file di dati con quello fotografato all'inizio. Se un caso
 * futuro scrivesse davvero, il test lo dice invece di lasciare il repository
 * sporco. Coprire i rami che scrivono richiede di rendere il path iniettabile,
 * come già fatto per `pluginSys` (`pluginsRootPath`) e `themeSys`
 * (`themesRootPath`) — vedi TODO.md §5.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { userUsert } = require('../../userManagement');

const PLUGIN_DIR = path.join(__dirname, '..', '..');
const DATA_FILES = [
  path.join(PLUGIN_DIR, 'userAccount.json5'),
  path.join(PLUGIN_DIR, 'userRole.json5'),
];

const digest = (file) => (fs.existsSync(file)
  ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  : 'ASSENTE');

let dataDigests = null;

beforeAll(() => {
  dataDigests = DATA_FILES.map(digest);
});

afterAll(() => {
  // Rete di sicurezza sull'isolamento: nessuno di questi test deve aver toccato
  // i file di dati reali del plugin.
  DATA_FILES.forEach((file, i) => {
    expect({ file: path.basename(file), digest: digest(file) })
      .toEqual({ file: path.basename(file), digest: dataDigests[i] });
  });
});

/** Argomenti validi, da cui ogni caso devia per un campo solo. */
const validArgs = () => ['nuovoUtente', 'password-lunga-abbastanza', 'nuovo@example.com', [2]];

describe('userUsert() — argomenti obbligatori', () => {
  test.each([
    ['username', 0],
    ['password', 1],
    ['email', 2],
    ['roleIds', 3],
  ])('%s mancante → errore con errorType "all"', async (_campo, index) => {
    const args = validArgs();
    args[index] = undefined;

    const res = await userUsert(...args);
    expect(res.error).toBeDefined();
    expect(res.errorType).toBe('all');
    expect(res.success).toBeUndefined();
  });

  test('stringa vuota conta come mancante (non come valore valido)', async () => {
    const res = await userUsert('', 'password', 'a@b.co', [2]);
    expect(res.errorType).toBe('all');
  });
});

describe('userUsert() — roleIds', () => {
  test('roleIds non array → rifiutato', async () => {
    // Un numero singolo è l'errore naturale di chi non conosce il modello
    // multi-ruolo: deve essere respinto, non interpretato.
    const res = await userUsert('utente', 'password', 'a@b.co', 2);
    expect(res.errorType).toBe('roleIds');
  });

  test('roleIds stringa → rifiutato', async () => {
    const res = await userUsert('utente', 'password', 'a@b.co', '2');
    expect(res.errorType).toBe('roleIds');
  });
});

describe('userUsert() — regole sullo username', () => {
  // Lo username diventa una CHIAVE dentro userAccount.json5: i vincoli non sono
  // estetici, tengono insieme il formato del file.
  test.each([
    ['con spazio in mezzo', 'utente rotto'],
    ['con spazio iniziale', ' utente'],
    ['con spazio finale', 'utente '],
  ])('%s → rifiutato', async (_caso, username) => {
    const res = await userUsert(username, 'password', 'a@b.co', [2]);
    expect(res.errorType).toBe('username');
  });

  test.each([
    ['punto',          'ut.ente'],
    ['chiocciola',     'ut@ente'],
    ['slash',          'ut/ente'],
    ['accento',        'utentè'],
    ['parentesi',      'utente(1)'],
    ['virgolette',     'ut"ente'],
  ])('carattere non ammesso (%s) → rifiutato', async (_caso, username) => {
    const res = await userUsert(username, 'password', 'a@b.co', [2]);
    expect(res.errorType).toBe('username');
  });

  test('meno di 3 caratteri → rifiutato', async () => {
    const res = await userUsert('ab', 'password', 'a@b.co', [2]);
    expect(res.errorType).toBe('username');
    expect(res.error).toMatch(/3/);
  });

  test('underscore e trattino sono ammessi (non devono essere respinti)', async () => {
    // Caso a specchio: verifica che la regex non sia più stretta di quanto dichiara.
    // Si ferma comunque prima di scrivere, perché l'email qui è invalida.
    const res = await userUsert('utente_con-trattino', 'password', 'email-non-valida', [2]);
    expect(res.errorType).toBe('email');   // superato il controllo sullo username
  });
});

describe('userUsert() — formato dell\'email', () => {
  test.each([
    ['senza chiocciola',     'utente.example.com'],
    ['senza dominio',        'utente@'],
    ['senza parte locale',   '@example.com'],
    ['senza TLD',            'utente@example'],
    ['con spazio',           'ut ente@example.com'],
    ['solo spazi',           '   '],
  ])('%s → rifiutata', async (_caso, email) => {
    const res = await userUsert('utenteValido', 'password', email, [2]);
    expect(res.errorType).toBe('email');
  });
});

describe('userUsert() — aggiornamento di un utente inesistente', () => {
  test('isNewUser: false su username assente → errore, senza scrivere', async () => {
    // Unico caso che arriva a LEGGERE userAccount.json5. Ritorna prima della
    // scrittura, e l'afterAll verifica che il file sia rimasto intatto.
    const res = await userUsert('utenteCheNonEsisteDavvero', 'password', 'x@y.co', [2], false);
    expect(res.errorType).toBe('username');
    expect(res.error).toMatch(/non esiste/);
  });
});
