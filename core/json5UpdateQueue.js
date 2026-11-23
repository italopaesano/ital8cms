/**
 * JSON5 UPDATE QUEUE — il ciclo leggi-modifica-scrivi, senza sovrapposizioni
 *
 * Esiste per due difetti con la stessa causa (REVIEW.md → B1 e B2), e per la
 * metà pratica di un terzo (B7).
 *
 * ─── IL PROBLEMA, DETTO CON PRECISIONE ───────────────────────────────────────
 * Node esegue un solo thread, quindi finché una funzione non incontra un `await`
 * nessun altro codice può interporsi: il classico ciclo leggi-modifica-scrivi è
 * **sicuro**, a patto che non ci sia un `await` in mezzo. In
 * `updateUserProfile` c'era:
 *
 *     const userAccount = loadJson5(path);                  // legge lo stato
 *     const hash = await bcrypt.hash(password, 10);         // ~100 ms, CEDE il controllo
 *     userAccount.users[u].hashPassword = hash;
 *     fs.writeFileSync(path, JSON.stringify(userAccount));  // riscrive TUTTO
 *
 * Durante quell'`await` Node esegue altre richieste. Se due persone salvano il
 * profilo insieme, la seconda scrittura si basa su una copia del file letta
 * PRIMA della prima: una delle due modifiche sparisce, e **entrambe leggono
 * « Modifica riuscita »**. `bcrypt.hash` è lento di proposito — è il suo scopo —
 * quindi la finestra non è di microsecondi: è ampia e facile da sovrapporre.
 *
 * Lo stesso schema colpisce le combinazioni miste: un amministratore che cancella
 * un utente mentre quell'utente cambia la propria email **lo resuscita**.
 *
 * ─── COSA FA QUESTO MODULO ───────────────────────────────────────────────────
 * Serializza per FILE: le modifiche allo stesso file si accodano e la lettura di
 * ciascuna avviene dopo la scrittura della precedente. Il mutatore riceve
 * sempre il contenuto **fresco**, qualunque `await` abbia fatto chi l'ha
 * chiamato. La scrittura passa da `saveJson5`, che è già atomica (temp +
 * rename), quindi un'interruzione non lascia un file troncato.
 *
 * ─── IL LIMITE, DICHIARATO ───────────────────────────────────────────────────
 * La coda vive in memoria, quindi copre un SOLO processo. Con `pm2 -i max` N
 * processi hanno N code che non si conoscono e il difetto torna: è B7, e la sua
 * via breve è dichiarare l'installazione single-process e farlo RILEVARE al
 * boot, non promettere qui una protezione che questo modulo non può dare.
 *
 * ─── PERCHÉ NON UN LOCK SU FILE ──────────────────────────────────────────────
 * Un lockfile andrebbe gestito su crash, timeout, lock orfani e NFS: più
 * superficie di quanta ne risolva per un CMS dichiaratamente single-process.
 * Una catena di promesse per file non ha stato su disco e non può restare
 * appesa: se il mutatore lancia, la catena riprende dalla richiesta successiva.
 *
 * @module core/json5UpdateQueue
 */

'use strict';

const loadJson5 = require('./loadJson5');
const saveJson5 = require('./saveJson5');
const path = require('path');

/**
 * Una coda per file: `{ tail, pending }`.
 *
 * La chiave è il path ASSOLUTO risolto — due chiamanti che nominano lo stesso
 * file in modi diversi devono finire nella stessa coda, altrimenti la
 * serializzazione è un'illusione. `pending` serve solo a liberare la voce quando
 * l'ultimo accodato ha finito: senza, la Map crescerebbe di un'entry per ogni
 * file mai toccato e non la libererebbe mai.
 */
const queues = new Map();

/**
 * Esegue `task` quando il file è libero, e lascia la coda pulita in ogni caso.
 *
 * @param {string} filePath
 * @param {Function} task
 * @returns {Promise<*>} il valore restituito da `task`
 */
function enqueue(filePath, task) {
  const key = path.resolve(filePath);
  const entry = queues.get(key) || { tail: Promise.resolve(), pending: 0 };
  entry.pending += 1;
  queues.set(key, entry);

  // Si parte sia che il precedente sia riuscito sia che abbia fallito: un
  // mutatore che lancia NON deve bloccare la coda per sempre.
  const run = () => task();
  const current = entry.tail.then(run, run);

  // La coda tiene una promessa che non rigetta mai: un rigetto non gestito
  // arriverebbe a `unhandledRejection` → processSafetyNet → uscita del processo.
  entry.tail = current.then(() => {}, () => {});
  entry.tail.then(() => {
    entry.pending -= 1;
    if (entry.pending === 0 && queues.get(key) === entry) queues.delete(key);
  });

  return current;
}

/**
 * Leggi-modifica-scrivi serializzato su un file `.json5`.
 *
 * Il mutatore riceve il contenuto **fresco** (riletto dentro la coda) e può
 * essere asincrono. Restituisca l'oggetto da scrivere, oppure `null`/`undefined`
 * per non scrivere nulla — utile quando, riletto il file, la modifica non serve
 * più (l'utente è già stato cancellato, il valore è già quello).
 *
 * @param {string} filePath          - Percorso del file .json5
 * @param {Function} mutator         - `(data) => object|null|Promise<object|null>`
 * @param {object} [options]
 * @param {object} [options.fallback] - Dato iniziale se il file non esiste
 * @returns {Promise<{written: boolean, data: object|null}>}
 */
function updateJson5Serialized(filePath, mutator, options = {}) {
  return enqueue(filePath, async () => {
    let current;
    try {
      current = loadJson5(filePath);
    } catch (err) {
      if (options.fallback === undefined) throw err;
      current = options.fallback;
    }

    const next = await mutator(current);
    if (next === null || next === undefined) return { written: false, data: current };

    await saveJson5(filePath, next);
    return { written: true, data: next };
  });
}

/**
 * Scrittura serializzata e atomica, senza rilettura.
 *
 * Per chi ha già l'oggetto completo e non ha bisogno di vedere lo stato attuale.
 * Resta nella stessa coda, quindi non può sovrapporsi a un
 * `updateJson5Serialized` sullo stesso file.
 *
 * @param {string} filePath
 * @param {object|string} data
 * @returns {Promise<void>}
 */
function writeJson5Serialized(filePath, data) {
  return enqueue(filePath, () => saveJson5(filePath, data));
}

/** Quante code sono vive. Solo per i test: la Map non deve crescere senza fine. */
function pendingQueueCount() {
  return queues.size;
}

module.exports = { updateJson5Serialized, writeJson5Serialized, pendingQueueCount };
