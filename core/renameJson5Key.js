/**
 * renameJson5Key — rinomina una chiave di un file `.json5` IN POSTO, preservando
 * posizione, commenti, valore e formattazione di tutto il resto.
 *
 * ─── LA SESTA OPERAZIONE ──────────────────────────────────────────────────────
 * Lo strato di chirurgia testuale del core copriva cinque operazioni: leggere
 * (`loadJson5`), riscrivere tutto (`saveJson5`, che perde i commenti), aggiornare
 * un valore (`editJson5`), aggiungere-o-aggiornare (`setJson5Key`), rimuovere
 * (`removeJson5Key`). Rinominare non c'era.
 *
 * Era stata dichiarata FUORI PERIMETRO, con questo argomento: una rinomina non è
 * esprimibile come `setJson5Key` + `removeJson5Key`, perché il primo inserisce in
 * testa al blocco o dopo una chiave indicata — quindi la chiave rinominata si
 * SPOSTEREBBE e perderebbe il blocco di commento che la precede.
 *
 * L'argomento era giusto e la conclusione sbagliata: descriveva una rinomina
 * fatta COMPONENDO le altre due. Una rinomina IN POSTO non sposta niente — è uno
 * splice su `[keyStart, keyEnd)`, e `locatePath` quei due indici li calcola già.
 * Il valore non viene nemmeno letto.
 *
 * ─── IL COSTO DELLA SUA ASSENZA, PAGATO DUE VOLTE ─────────────────────────────
 * Come per `removeJson5Key`, la rinomina era stata riscritta a mano dentro uno
 * script di migrazione — con `String.replace` invece della macchina di scansione
 * del core. Ne sono usciti due difetti, entrambi riprodotti come test:
 *
 *   • `replace` con un pattern STRINGA sostituisce solo la PRIMA occorrenza, e
 *     l'ancora non era vincolata al codice. Un'ancora dentro un COMMENTO — per
 *     esempio una regola commentata per disabilitarla, che è il modo naturale di
 *     disabilitarla — veniva riscritta al posto della regola vera, che restava
 *     letterale. Con il log che diceva « 1 pattern convertiti ».
 *   • la stessa chiave in DUE blocchi diversi (`hardcodedRules` e `customRules`)
 *     ne vedeva convertita una sola; alla riesecuzione la guardia « già
 *     convertito » la dichiarava fatta, e il letterale residuo non veniva più
 *     nominato mai.
 *
 * Qui non possono ripetersi: `locatePath` cerca fra i caratteri che `buildCodeMask`
 * marca come CODICE, quindi una chiave dentro un commento non viene mai trovata, e
 * il path include il blocco che la ospita, quindi due omonime in blocchi diversi
 * sono due bersagli distinti e non ambigui.
 * → docs/decisions/json5-key-operations.it.md
 *
 * ─── COSA NON SI AZZARDA ──────────────────────────────────────────────────────
 *   - **collisione = rifiuto.** Se `newKey` esiste già nello stesso blocco, la
 *     rinomina produrrebbe due chiavi omonime: `json5.parse` ne terrebbe in
 *     silenzio una sola (l'ultima) e `locatePath` rifiuterebbe per sempre quel
 *     path come ambiguo. Perdere un valore in silenzio è peggio che non rinominare;
 *   - un path AMBIGUO fa lanciare (eredita la severità di `locatePath`);
 *   - la postcondizione verifica, PRIMA di scrivere, che la chiave nuova porti il
 *     valore della vecchia, che la vecchia sia sparita, e che la STRUTTURA del
 *     resto — ordine delle chiavi compreso — sia identica.
 *
 * ─── CHIAVE ASSENTE: NO-OP, NON ERRORE ────────────────────────────────────────
 * Come `removeJson5Key`, e per la stessa ragione: le migrazioni devono essere
 * idempotenti. Alla seconda esecuzione la chiave vecchia non c'è più, e quello è
 * il risultato atteso. Vale anche per `newKey === oldKey`, che non è un errore ma
 * un lavoro già fatto.
 *
 * ─── LA CHIAVE ESCE QUOTATA ───────────────────────────────────────────────────
 * Il nome nuovo è scritto con `JSON.stringify`, quindi fra doppi apici e con gli
 * escape giusti. Una chiave JSON5 non quotata che venga rinominata diventa
 * quotata: è la stessa normalizzazione che `editJson5` applica a ciò che riscrive,
 * e qui è necessaria perché un nome come `{{admin}}/**` non è un identificatore.
 *
 * @module core/renameJson5Key
 */

'use strict';

const fs = require('fs').promises;
const json5 = require('json5');
const saveJson5 = require('./saveJson5');
const {
  buildCodeMask,
  buildDepthArray,
  locatePath,
} = require('./json5Scan');

/**
 * Cammina il path su un oggetto deserializzato. Ritorna `undefined` se un
 * segmento qualsiasi non esiste.
 *
 * Il lookup passa da `hasOwnProperty`: i segmenti arrivano da un file di
 * configurazione, e senza questo controllo `constructor` o `toString`
 * pescherebbero dal PROTOTIPO un valore truthy, facendo credere che la chiave
 * esista. È la stessa classe di difetto di REVIEW.md → B4.
 */
function readPath(root, pathSegments) {
  let node = root;
  for (let i = 0; i < pathSegments.length; i += 1) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(node, pathSegments[i])) return undefined;
    node = node[pathSegments[i]];
  }
  return { value: node };
}

/**
 * Rinomina una chiave di un oggetto PRESERVANDO LA POSIZIONE (per la
 * postcondizione).
 *
 * Ricostruire il blocco mettendo la chiave nuova in coda non servirebbe: una
 * rinomina in posto non sposta niente, quindi la struttura attesa deve avere la
 * chiave nuova esattamente dove stava la vecchia. Senza questo, il confronto
 * fallirebbe su ogni rinomina che non riguardi l'ultima chiave.
 */
function renameInPlace(parent, oldKey, newKey) {
  const rebuilt = {};
  for (const key of Object.keys(parent)) {
    if (key === oldKey) rebuilt[newKey] = parent[oldKey];
    else rebuilt[key] = parent[key];
  }
  return rebuilt;
}

/**
 * Rinomina una chiave in un file `.json5`.
 *
 * @param {string} filePath - percorso del file
 * @param {string|string[]} fieldNameOrPath - chiave top-level, o path annidato il
 *   cui ULTIMO segmento è la chiave da rinominare
 * @param {string} newKey - il nome nuovo (solo il nome, non un path)
 * @returns {Promise<{changed: boolean, oldKey: string}>}
 *   `changed: false` se la chiave non c'era, o se si chiamava già così.
 * @throws se gli argomenti hanno il tipo sbagliato, se il file non è JSON5
 *   valido, se la radice non è un oggetto, se `newKey` esiste già nello stesso
 *   blocco (collisione), se il path è ambiguo, o se la postcondizione non regge
 *   (in quest'ultimo caso NIENTE viene scritto).
 */
async function renameJson5Key(filePath, fieldNameOrPath, newKey) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('renameJson5Key: filePath must be a non-empty string');
  }

  // Normalizzazione identica ai fratelli: i moduli dello strato accettano la
  // stessa forma di argomento, e divergere sarebbe una trappola.
  let pathSegments;
  if (typeof fieldNameOrPath === 'string') {
    if (fieldNameOrPath.length === 0) {
      throw new Error('renameJson5Key: fieldName must be a non-empty string');
    }
    pathSegments = [fieldNameOrPath];
  } else if (Array.isArray(fieldNameOrPath)) {
    if (fieldNameOrPath.length === 0) {
      throw new Error('renameJson5Key: path array must contain at least one segment');
    }
    for (const seg of fieldNameOrPath) {
      if (typeof seg !== 'string' || seg.length === 0) {
        throw new Error('renameJson5Key: every path segment must be a non-empty string');
      }
    }
    pathSegments = fieldNameOrPath;
  } else {
    throw new Error(
      'renameJson5Key: second argument must be a string (top-level field name) or '
      + 'an array of strings (nested path)'
    );
  }

  if (typeof newKey !== 'string' || newKey.length === 0) {
    throw new Error('renameJson5Key: newKey must be a non-empty string');
  }

  const oldKey = pathSegments[pathSegments.length - 1];
  const parentPath = pathSegments.slice(0, -1);

  const source = await fs.readFile(filePath, 'utf8');

  let parsed;
  try {
    parsed = json5.parse(source);
  } catch (err) {
    throw new Error(`renameJson5Key: ${filePath} is not valid JSON5 — ${err.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`renameJson5Key: the root of ${filePath} is not a JSON5 object`);
  }

  // Già fatto: non è un errore, è un lavoro svolto. Si controlla PRIMA della
  // presenza, così una riesecuzione su un file già rinominato non inciampa
  // nella collisione con se stessa.
  if (oldKey === newKey) {
    return { changed: false, oldKey };
  }

  // Chiave assente → no-op. Si decide sull'oggetto DESERIALIZZATO: è l'unica
  // fonte che risponde senza ambiguità, e costa una parse che serve comunque.
  const found = readPath(parsed, pathSegments);
  if (found === undefined) {
    return { changed: false, oldKey };
  }

  // Collisione → rifiuto. Due chiavi omonime nello stesso blocco sono JSON5
  // valido, quindi nessun errore comparirebbe: `json5.parse` terrebbe solo
  // l'ultima e il valore dell'altra sparirebbe in silenzio.
  const parentHolder = readPath(parsed, parentPath);
  if (parentHolder === undefined
      || parentHolder.value === null
      || typeof parentHolder.value !== 'object'
      || Array.isArray(parentHolder.value)) {
    throw new Error(
      `renameJson5Key: il blocco che ospita "${oldKey}" in ${filePath} non è un oggetto`
    );
  }
  if (Object.prototype.hasOwnProperty.call(parentHolder.value, newKey)) {
    throw new Error(
      `renameJson5Key: "${newKey}" esiste già nello stesso blocco di ${filePath} — `
      + 'rinominare produrrebbe due chiavi omonime, di cui una perderebbe il proprio '
      + 'valore in silenzio. Niente è stato scritto'
    );
  }

  const mask = buildCodeMask(source);
  const depth = buildDepthArray(source, mask);
  // Lancia se il path è ambiguo o non localizzabile: a questo punto sappiamo che
  // esiste nell'oggetto, quindi un fallimento qui è una discrepanza fra testo e
  // struttura e non va aggirata.
  const occ = locatePath(source, mask, depth, pathSegments, filePath);

  // La rinomina: il solo intervallo della CHIAVE. Il valore, i commenti, la
  // posizione e l'indentazione non vengono nemmeno guardati.
  const next = source.slice(0, occ.keyStart)
    + JSON.stringify(newKey)
    + source.slice(occ.keyEnd);

  // ── Postcondizione: si verifica PRIMA di scrivere ──────────────────────────
  let reparsed;
  try {
    reparsed = json5.parse(next);
  } catch (err) {
    throw new Error(
      `renameJson5Key: la rinomina di "${oldKey}" in "${newKey}" dentro ${filePath} `
      + `avrebbe prodotto un file non valido (${err.message}) — niente è stato scritto`
    );
  }

  const expected = json5.parse(source);
  const expectedParent = parentPath.length === 0
    ? expected
    : readPath(expected, parentPath).value;
  const rebuilt = renameInPlace(expectedParent, oldKey, newKey);
  if (parentPath.length === 0) {
    if (JSON.stringify(rebuilt) !== JSON.stringify(reparsed)) {
      throw new Error(
        `renameJson5Key: la rinomina di "${oldKey}" in ${filePath} avrebbe cambiato `
        + 'anche altro nel documento — niente è stato scritto'
      );
    }
  } else {
    const grandParent = readPath(expected, parentPath.slice(0, -1)).value;
    grandParent[parentPath[parentPath.length - 1]] = rebuilt;
    if (JSON.stringify(expected) !== JSON.stringify(reparsed)) {
      throw new Error(
        `renameJson5Key: la rinomina di "${oldKey}" in ${filePath} avrebbe cambiato `
        + 'anche altro nel documento — niente è stato scritto'
      );
    }
  }

  await saveJson5(filePath, next);
  return { changed: true, oldKey };
}

module.exports = renameJson5Key;
