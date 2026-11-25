/**
 * Presidio di CUCITURA: chi scrive i file dei dati utente × review della v3.49.0.
 *
 * ─── IL DIFETTO CHE QUESTO TEST ESISTE PER IMPEDIRE ──────────────────────────
 * La v3.45.0 ha portato `userUsert` e `updateUserProfile` sulla coda di
 * `core/json5UpdateQueue.js` per chiudere il lost update di REVIEW.md → B2. Ma
 * `plugins/adminUsers/roleManagement.js` scriveva lo **stesso**
 * `userAccount.json5` con un suo `writeJson5Atomic`, e una coda che serializza
 * solo i propri chiamanti **non serializza niente**.
 *
 * Misurato prima della correzione, nella forma realistica (un `updateProfile`
 * in volo, cioè i ~100 ms di `bcrypt.hash`): la cancellazione di un ruolo
 * custom veniva annullata in silenzio **30 volte su 30**, lasciando
 * `userRole.json5` senza il ruolo e `userAccount.json5` che lo referenzia.
 *
 * Il difetto non era nel codice nuovo né in quello vecchio: era nella
 * **cucitura** fra i due. Nessun test unitario dei due pezzi poteva vederlo, ed
 * è il motivo per cui questo presidio guarda il repository invece del
 * comportamento.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RADICE = path.join(__dirname, '../../..');
const PLUGIN = path.join(RADICE, 'plugins/adminUsers');

/** I due file che contengono i dati degli account e dei ruoli. */
const FILE_DATI = ['userAccount.json5', 'userRole.json5'];

/**
 * Esenzione dichiarata: lo script del wizard d'installazione.
 *
 * Gira **prima** che il server esista (profilo `production`/`demo` di
 * `npm run start-configure`), quindi non può sovrapporsi a una richiesta: non
 * c'è concorrenza da serializzare. È elencato qui, e non ignorato in silenzio,
 * perché il giorno in cui qualcosa dello wizard girasse a server attivo questa
 * riga è il posto dove accorgersene.
 */
const ESENTI = ['scripts/init.js'];

/** Tutti i .js del plugin, esclusi i test. */
function sorgenti(dir, acc = []) {
  for (const voce of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, voce.name);
    if (voce.isDirectory()) {
      if (voce.name === 'tests' || voce.name === 'node_modules') continue;
      sorgenti(p, acc);
      continue;
    }
    if (voce.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

/**
 * Toglie i commenti dal sorgente prima di cercarci dentro.
 *
 * ⚠️ Serve, e lo si è scoperto subito: la prima versione di questo censimento
 * segnalava `main.js` perché contiene `fs.writeFileSync(` **dentro un
 * commento** — quello che cita il codice vecchio per spiegare il difetto. È la
 * stessa lezione del presidio di B3: un presidio che cade su un commento è un
 * presidio che insegna a cancellare i commenti.
 *
 * Si rimuovono i blocchi `/* … *\/` e le righe che *iniziano* con `//` o `*`.
 * Un commento in coda a una riga di codice sopravvive, ed è corretto così: in
 * quel caso sulla riga c'è anche il codice, che è ciò che si vuole esaminare.
 */
function senzaCommenti(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((riga) => {
      const t = riga.trim();
      return !t.startsWith('//') && !t.startsWith('*');
    })
    .join('\n');
}

const file = sorgenti(PLUGIN).map((p) => ({
  rel: path.relative(PLUGIN, p),
  src: senzaCommenti(fs.readFileSync(p, 'utf8')),
}));

describe('censimento dei writer di userAccount.json5 e userRole.json5', () => {
  test('il censimento trova dei file da esaminare (non è un test vuoto)', () => {
    // Senza questo, un errore nella scansione renderebbe verdi tutti gli altri.
    expect(file.length).toBeGreaterThan(3);
    expect(file.some((f) => f.rel === 'userManagement.js')).toBe(true);
    expect(file.some((f) => f.rel === 'roleManagement.js')).toBe(true);
    // E che lo spogliatore di commenti non abbia svuotato i sorgenti: un
    // censimento su stringhe vuote passerebbe sempre.
    for (const f of file) expect(f.src.length).toBeGreaterThan(50);
    expect(file.find((f) => f.rel === 'roleManagement.js').src).toContain('updateJson5Serialized');
  });

  test('nessuna scrittura diretta su disco fuori dalla coda', () => {
    const colpevoli = [];

    for (const { rel, src } of file) {
      if (ESENTI.includes(rel)) continue;

      // Chi nomina uno dei due file di dati non deve usare le primitive di
      // scrittura: deve passare dalla coda, che è l'unico punto che serializza.
      const nominaDati = FILE_DATI.some((nome) => src.includes(nome));
      if (!nominaDati) continue;

      for (const primitiva of ['fs.writeFileSync(', 'fs.renameSync(', 'fs.writeFile(']) {
        if (src.includes(primitiva)) colpevoli.push(`${rel} → ${primitiva}`);
      }
    }

    expect(colpevoli).toEqual([]);
  });

  test('chi scrive quei file importa la coda condivisa', () => {
    const senzaCoda = [];

    for (const { rel, src } of file) {
      if (ESENTI.includes(rel)) continue;
      // « Scrive » = passa uno dei due path a una funzione di scrittura.
      const scrive = /(?:writeJson5Serialized|updateJson5Serialized|saveJson5)\s*\(/.test(src)
        || /write[A-Za-z0-9]*\(\s*(?:users|roles)FilePath/.test(src);
      if (!scrive) continue;

      if (!src.includes("require('../../core/json5UpdateQueue')")) senzaCoda.push(rel);
    }

    expect(senzaCoda).toEqual([]);
  });

  test('`saveJson5` non è chiamato direttamente su quei file: scavalcherebbe la coda', () => {
    // `saveJson5` è atomico ma NON serializzato: usarlo direttamente riapre
    // esattamente il difetto, con l'aggravante di sembrare corretto.
    const diretti = [];
    for (const { rel, src } of file) {
      if (ESENTI.includes(rel)) continue;
      if (/saveJson5\s*\(\s*(?:users|roles)FilePath/.test(src)) diretti.push(rel);
    }
    expect(diretti).toEqual([]);
  });
});
