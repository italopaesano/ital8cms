/**
 * materializeFromDefault — crea un file di configurazione "vivo" (`x.json5`)
 * copiando il suo sidecar di default (`x.default.json5`) quando il vivo non
 * esiste ancora.
 *
 * È il mattone atomico del ciclo di vita dei config (vedi
 * docs/decisions/config-lifecycle.it.md §1, §3): il `.default` è la fonte di
 * verità versionata e immutabile; il `.json5` vivo è generato da esso e poi
 * modificabile. Questa utility materializza UNA coppia default→live; la logica
 * di scansione "tutti i config mancanti di un plugin/tema" e l'aggancio al boot
 * vivono a un livello superiore.
 *
 * Comportamento:
 *   1. Se il file vivo ESISTE già → no-op. Non viene mai sovrascritto (le
 *      modifiche dell'utente sono sacre); ritorna { created: false }.
 *   2. Se manca → il default viene validato (esistenza + JSON5 parseabile,
 *      con messaggi chiari via loadJson5), poi il suo contenuto RAW viene
 *      copiato fedelmente nel vivo (preserva commenti, formattazione,
 *      `schemaVersion`) con scrittura ATOMICA (temp + rename, via saveJson5).
 *
 * Copia byte-fedele (non parse+serialize) di proposito: il vivo deve nascere
 * identico al default, commenti inclusi. Lo stato runtime che NON appartiene al
 * default (es. `isInstalled` sui descrittori) viene aggiunto in seguito dal
 * boot, non qui.
 *
 * API:
 *   materializeFromDefault(defaultPath, livePath) → Promise<{ created, reason }>
 *     - { created: false, reason: 'already-exists' } se il vivo c'era già.
 *     - { created: true,  reason: 'materialized'  } se è stato generato.
 *
 *   materializeFromDefault.sync(defaultPath, livePath) → { created, reason }
 *     Stesso contratto, versione sincrona. Serve ai config che vengono letti
 *     PRIMA che il boot entri in codice asincrono: `koaSession.json5` è letto dal
 *     montaggio dei priority middleware, che in index.js gira a livello di modulo
 *     (CommonJS, niente top-level await) e quindi non può attendere una Promise.
 *     Il suffisso segue la convenzione di Node (`readFileSync`, `renameSync`).
 *
 * Throws su:
 *   - argomenti non validi (path non stringa o vuoti);
 *   - default mancante o non leggibile;
 *   - default con sintassi JSON5 non valida.
 *   In caso di default non valido, il file vivo NON viene scritto (la validazione
 *   precede sempre la scrittura).
 */

'use strict';

const fsSync = require('fs');
const fs = fsSync.promises;
const path = require('path');
const json5 = require('json5');
const loadJson5 = require('./loadJson5');
const saveJson5 = require('./saveJson5');

/** Validazione degli argomenti, condivisa dalle due varianti. */
function assertPaths(defaultPath, livePath) {
  if (typeof defaultPath !== 'string' || defaultPath.length === 0) {
    throw new Error('materializeFromDefault: defaultPath must be a non-empty string');
  }
  if (typeof livePath !== 'string' || livePath.length === 0) {
    throw new Error('materializeFromDefault: livePath must be a non-empty string');
  }
}

/**
 * Materializza un file di config vivo dal suo sidecar di default, se manca.
 *
 * @param {string} defaultPath - Path del `x.default.json5` (fonte di verità).
 * @param {string} livePath    - Path del `x.json5` vivo (destinazione).
 * @returns {Promise<{created: boolean, reason: string}>}
 * @throws {Error} Se gli argomenti non sono validi, o il default manca/è JSON5 non valido.
 */
async function materializeFromDefault(defaultPath, livePath) {
  assertPaths(defaultPath, livePath);

  // 1. Il file vivo esiste già? → no-op, non sovrascrivere mai i dati utente.
  let liveExists = false;
  try {
    await fs.access(livePath);
    liveExists = true;
  } catch (_) {
    liveExists = false;
  }
  if (liveExists) {
    return { created: false, reason: 'already-exists' };
  }

  // 2. Valida il default: esistenza + JSON5 parseabile (messaggi chiari —
  //    "file non trovato" / "sintassi JSON5 non valida" — via loadJson5).
  loadJson5(defaultPath);

  // 3. Legge il contenuto RAW del default (copia byte-fedele: commenti,
  //    formattazione e schemaVersion vengono preservati).
  const raw = await fs.readFile(defaultPath, 'utf8');

  // 4. Scrive il vivo in modo ATOMICO (saveJson5 ri-valida la stringa e usa
  //    temp + rename: nessun file parziale in caso di errore).
  await saveJson5(livePath, raw);

  return { created: true, reason: 'materialized' };
}

/**
 * Variante SINCRONA di materializeFromDefault, stesso contratto e stessa
 * semantica (no-op se il vivo esiste, copia byte-fedele, scrittura atomica).
 *
 * Esiste perché alcuni config del core vengono letti prima che il boot entri in
 * codice asincrono: `koaSession.json5` è letto dal montaggio dei priority
 * middleware, che in `index.js` gira a livello di modulo. Node non offre una
 * versione sincrona di `fs.promises`, quindi le poche righe di I/O sono
 * necessariamente duplicate; la validazione (argomenti + parse del default) è
 * invece condivisa, così le due varianti non possono divergere sulle regole.
 *
 * @param {string} defaultPath - Path del `x.default.json5` (fonte di verità).
 * @param {string} livePath    - Path del `x.json5` vivo (destinazione).
 * @returns {{created: boolean, reason: string}}
 * @throws {Error} Se gli argomenti non sono validi, o il default manca/è JSON5 non valido.
 */
function materializeFromDefaultSync(defaultPath, livePath) {
  assertPaths(defaultPath, livePath);

  if (fsSync.existsSync(livePath)) {
    return { created: false, reason: 'already-exists' };
  }

  // Stessa validazione della variante async: messaggi chiari ("file non trovato"
  // / "sintassi JSON5 non valida") e `.code` propagato, che il chiamante usa per
  // distinguere l'installazione rotta dall'errore di sintassi.
  loadJson5(defaultPath);

  const raw = fsSync.readFileSync(defaultPath, 'utf8');
  json5.parse(raw); // ri-valida la stringa esatta che sta per essere scritta

  const resolved = path.isAbsolute(livePath) ? livePath : path.resolve(process.cwd(), livePath);
  const tempPath = resolved + '.tmp';
  fsSync.writeFileSync(tempPath, raw, 'utf8');
  fsSync.renameSync(tempPath, resolved);

  return { created: true, reason: 'materialized' };
}

module.exports = materializeFromDefault;
// Agganciata alla funzione principale come `loadJson5.warnConfigError`:
// al punto di chiamata si legge `materializeFromDefault.sync(...)`.
module.exports.sync = materializeFromDefaultSync;
