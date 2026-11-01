/**
 * editJson5 — Edit-by-position editor for JSON5 files.
 *
 * Modifies a single field (top-level or nested) in a .json5 file while
 * preserving all comments, trailing commas, formatting, and other JSON5
 * features outside the modified field.
 *
 * Approach:
 *   1. Parse the file with json5 to validate it and confirm the path exists.
 *   2. Pre-scan the source to identify code regions vs. strings/comments.
 *   3. Walk the path step by step, locating each segment within its parent's
 *      value range, until the leaf is found.
 *   4. Replace the matched key+value with the normalized form
 *      `"fieldName": <newValue>` where newValue is JSON-serialized.
 *   5. Validate the result by re-parsing with json5 and comparing the value
 *      at the path.
 *   6. Write atomically via saveJson5(path, rawString).
 *
 * Scope (v3):
 *   - Field must already exist at the specified path. No creation of new
 *     fields (intermediate or leaf).
 *   - The path can be a string for top-level fields or an array of strings
 *     for nested paths. Array indexes (e.g., navigating into an array element)
 *     are not supported.
 *   - Intermediate path segments must point to plain objects. Arrays and
 *     scalars are not navigable.
 *   - The OLD value at the leaf can be any JSON5 value: scalar, object, array.
 *   - The NEW value can be any JSON-serializable value: scalar, object, array.
 *   - When replacing an object/array LEAF, comments INSIDE the old value are
 *     lost (the whole block is substituted). Comments at any other position
 *     in the file — including inside ancestor blocks but outside the leaf —
 *     are preserved.
 *   - Output is normalized for the modified pair only: quoted key, single
 *     space after colon, JSON.stringify for the value with 2-space indent.
 *   - Caller is responsible for value-type semantics (no true→1 normalization).
 *
 * Out of scope:
 *   - Adding new fields (intermediate or leaf).
 *   - Editing inside arrays via index (e.g., path = ['list', 0, 'name']).
 *   - Editing inside arrays via push/splice.
 *
 * API:
 *   editJson5(filePath, fieldName, newValue)
 *   editJson5(filePath, ['parent', 'child', ...], newValue)
 *
 * Returns: Promise<{ changed, oldValue, newValue }>
 *   - changed=false if the field already had the requested value (no-op).
 *
 * Throws on:
 *   - Invalid JSON5 in the source file.
 *   - Root is not a JSON5 object.
 *   - Path not found, or any intermediate segment missing.
 *   - Any intermediate segment is not a plain object (array or scalar).
 *   - Any segment appears multiple times at its expected depth (duplicates).
 *   - NEW value is not JSON-serializable (undefined, function, BigInt, etc.).
 *   - Post-edit validation failure (parse error or value mismatch).
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');
const json5 = require('json5');
const saveJson5 = require('./saveJson5');
// La scansione del testo vive in un modulo a sé: è di SOLA LETTURA, la usa anche
// `removeJson5Key`, e tenerla qui l'avrebbe lasciata esposta come `_internals` —
// un nome che dichiara « solo per i test » a un secondo modulo di produzione.
// → docs/decisions/json5-key-operations.it.md (D4)
const {
  buildCodeMask,
  buildDepthArray,
  locatePath,
  findRemovalSpan,
  findInsertionPoint,
  scanValue,
  skipWsAndCommentsForward,
} = require('./json5Scan');

// ── Helpers ──────────────────────────────────────────────────────────────────

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
  return true;
}


// ── Format a JS value for insertion, with proper indentation context ────────

function formatNewValue(value, baseIndent) {
  if (value === undefined) {
    throw new Error('editJson5: cannot serialize undefined as a JSON value');
  }
  let json;
  try {
    json = JSON.stringify(value, null, 2);
  } catch (e) {
    throw new Error(`editJson5: failed to serialize value: ${e.message}`);
  }
  if (json === undefined) {
    throw new Error('editJson5: value is not JSON-serializable');
  }
  if (!json.includes('\n')) return json;
  // Multi-line value: re-indent every line after the first to match the
  // surrounding context.
  const lines = json.split('\n');
  const out = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    out.push(baseIndent + lines[i]);
  }
  return out.join('\n');
}

// ── Sostituzione per chiave: perché non si riscrive il blocco ───────────────
//
// Sostituire il blocco intero con il valore riserializzato perde TUTTI i
// commenti che stavano dentro, compresi quelli di chiavi il cui valore non
// cambia. Misurato: cambiando solo `retryAfter` in un oggetto di tre chiavi,
// sparivano anche le spiegazioni di `status` e `maxHits`, i cui valori erano
// rimasti identici. Non è un limite tecnico — le chiavi danno IDENTITÀ, quindi
// si sa esattamente a chi appartiene ogni commento: era una scorciatoia.
//
// La realizzazione di « conserva i commenti » è: NON ricostruire. Se il blocco
// di testo non viene rifatto, i commenti non vanno spostati — e quindi non si
// possono spostare male.
//
//   oggetto → oggetto                  ricorre per CHIAVE
//   array → array, stessa lunghezza    ricorre per INDICE
//   lunghezze diverse / cambio di tipo  sostituzione del blocco + resoconto
//
// → docs/decisions/json5-key-operations.it.md (D3, D5)

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Il valore a un path su un oggetto deserializzato, o `undefined`. */
function readAtPath(root, pathSegments) {
  let node = root;
  for (const seg of pathSegments) {
    if (node === null || typeof node !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(node, seg)) return undefined;
    node = node[seg];
  }
  return node;
}

/**
 * I commenti contenuti in un intervallo di testo, per il resoconto.
 *
 * Serve solo quando il blocco DEVE essere ricostruito: il chiamante dichiara
 * cosa ha perso invece di lasciarlo dedurre. Un commento perso in silenzio è il
 * difetto; uno perso e dichiarato è una conseguenza.
 */
function collectCommentsIn(source, mask, from, to) {
  const found = [];
  let i = from;
  while (i < to) {
    if (mask[i] === 1 && (source[i] === '/' && (source[i + 1] === '/' || source[i + 1] === '*'))) {
      const isLine = source[i + 1] === '/';
      let end;
      if (isLine) {
        end = source.indexOf('\n', i);
        if (end === -1 || end > to) end = to;
      } else {
        end = source.indexOf('*/', i);
        end = end === -1 || end + 2 > to ? to : end + 2;
      }
      found.push(source.substring(i, end).trim());
      i = end;
      continue;
    }
    i += 1;
  }
  return found;
}

/**
 * Le span dei singoli elementi di un array, in ordine.
 *
 * `scanValue` sa dove finisce un valore; qui si scorre il contenuto fra `[` e
 * `]` saltando spazi, commenti e virgole. Resta PRIVATA: è l'unica consumatrice
 * oggi, e promuoverla in `json5Scan` prima che serva a un secondo chiamante
 * sarebbe la decisione presa al momento sbagliato.
 */
function enumerateArrayElements(source, mask, arrayStart, arrayEnd) {
  const spans = [];
  let i = arrayStart + 1;                 // dopo `[`
  const limit = arrayEnd - 1;             // prima di `]`
  while (i < limit) {
    i = skipWsAndCommentsForward(source, mask, i);
    if (i >= limit) break;
    if (source[i] === ',') { i += 1; continue; }
    const end = scanValue(source, mask, i);
    if (end === -1 || end > arrayEnd) break;
    spans.push({ start: i, end });
    i = end;
  }
  return spans;
}

/**
 * Sostituisce il valore a un path, ricorrendo invece di ricostruire.
 *
 * @param {string} source
 * @param {string[]} pathSegments
 * @param {*} newValue
 * @param {string} filePath - per i messaggi d'errore
 * @param {Array} dropped - raccoglie i commenti non preservabili (in place)
 * @returns {string} il testo nuovo
 */
function replaceValueAtPath(source, pathSegments, newValue, filePath, dropped) {
  const oldValue = readAtPath(json5.parse(source), pathSegments);

  // ── Oggetto → oggetto: per chiave ─────────────────────────────────────────
  if (isPlainObject(oldValue) && isPlainObject(newValue)) {
    let text = source;
    const newKeys = Object.keys(newValue);

    // 1. Chiavi presenti in entrambi, con valore diverso → ricorsione.
    for (const key of newKeys) {
      if (!Object.prototype.hasOwnProperty.call(oldValue, key)) continue;
      if (deepEqual(oldValue[key], newValue[key])) continue;
      text = replaceValueAtPath(text, [...pathSegments, key], newValue[key], filePath, dropped);
    }

    // 2. Chiavi nuove → inserimento DOPO la precedente del nuovo oggetto, così
    //    l'ordine che il chiamante ha scritto viene rispettato. Inserirle tutte
    //    in testa al blocco sarebbe più semplice e cambierebbe l'ordine.
    for (let i = 0; i < newKeys.length; i += 1) {
      const key = newKeys[i];
      if (Object.prototype.hasOwnProperty.call(oldValue, key)) continue;
      const mask = buildCodeMask(text);
      const depth = buildDepthArray(text, mask);
      const predecessor = i > 0 ? newKeys[i - 1] : null;
      const point = findInsertionPoint(text, mask, depth, pathSegments, predecessor, filePath);
      let insertion = `\n${point.indent}"${key}": ${formatNewValue(newValue[key], point.indent)},`;
      if (point.blockIsEmpty) insertion += `\n${point.parentIndent}`;
      text = text.substring(0, point.offset)
        + (point.needsComma ? ',' : '')
        + insertion
        + text.substring(point.offset);
    }

    // 3. Chiavi che non ci sono più → rimozione, con i loro commenti (D2).
    for (const key of Object.keys(oldValue)) {
      if (Object.prototype.hasOwnProperty.call(newValue, key)) continue;
      const mask = buildCodeMask(text);
      const depth = buildDepthArray(text, mask);
      const occ = locatePath(text, mask, depth, [...pathSegments, key], filePath);
      const span = findRemovalSpan(text, mask, occ);
      text = text.substring(0, span.from) + text.substring(span.to);
    }

    return text;
  }

  // ── Array → array di pari lunghezza: per indice ───────────────────────────
  if (Array.isArray(oldValue) && Array.isArray(newValue)
      && oldValue.length === newValue.length && oldValue.length > 0) {
    let text = source;
    // A ritroso: così lo splice di un elemento non sposta gli offset di quelli
    // che restano da fare, e non serve rifare la scansione a ogni giro.
    const mask = buildCodeMask(text);
    const depth = buildDepthArray(text, mask);
    const occ = locatePath(text, mask, depth, pathSegments, filePath);
    const spans = enumerateArrayElements(text, mask, occ.valueStart, occ.valueEnd);
    if (spans.length === oldValue.length) {
      for (let i = spans.length - 1; i >= 0; i -= 1) {
        if (deepEqual(oldValue[i], newValue[i])) continue;
        const indentMatch = /\n([ \t]*)$/.exec(text.substring(0, spans[i].start));
        const elementIndent = indentMatch ? indentMatch[1] : '';
        text = text.substring(0, spans[i].start)
          + formatNewValue(newValue[i], elementIndent)
          + text.substring(spans[i].end);
      }
      return text;
    }
    // Le span contate non corrispondono alla lunghezza dell'array: non si
    // indovina, si ricade sulla sostituzione del blocco qui sotto.
  }

  // ── Fallback: sostituzione del blocco ─────────────────────────────────────
  const mask = buildCodeMask(source);
  const depth = buildDepthArray(source, mask);
  const occ = locatePath(source, mask, depth, pathSegments, filePath);

  for (const text of collectCommentsIn(source, mask, occ.valueStart, occ.valueEnd)) {
    dropped.push({ path: [...pathSegments], text });
  }

  let lineStart = occ.keyStart;
  while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart -= 1;
  const indentRaw = source.substring(lineStart, occ.keyStart);
  const baseIndent = /^\s*$/.test(indentRaw) ? indentRaw : '';
  const leafKey = pathSegments[pathSegments.length - 1];
  const replacement = `"${leafKey}": ${formatNewValue(newValue, baseIndent)}`;

  return source.substring(0, occ.keyStart) + replacement + source.substring(occ.valueEnd);
}

// ── Main API ─────────────────────────────────────────────────────────────────

async function editJson5(filePath, fieldNameOrPath, newValue) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('editJson5: filePath must be a non-empty string');
  }

  // Normalize fieldName/path argument to an array of segments.
  let pathSegments;
  if (typeof fieldNameOrPath === 'string') {
    if (fieldNameOrPath.length === 0) {
      throw new Error('editJson5: fieldName must be a non-empty string');
    }
    pathSegments = [fieldNameOrPath];
  } else if (Array.isArray(fieldNameOrPath)) {
    if (fieldNameOrPath.length === 0) {
      throw new Error('editJson5: path array must contain at least one segment');
    }
    for (const seg of fieldNameOrPath) {
      if (typeof seg !== 'string' || seg.length === 0) {
        throw new Error('editJson5: every path segment must be a non-empty string');
      }
    }
    pathSegments = fieldNameOrPath;
  } else {
    throw new Error(
      'editJson5: second argument must be a string (top-level field name) or ' +
      'an array of strings (nested path)'
    );
  }

  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  const source = await fs.readFile(resolvedPath, 'utf8');

  // High-level validation: file must be valid JSON5 with a root object, and
  // every segment of the path must navigate into a plain object until the
  // leaf is found.
  let parsed;
  try {
    parsed = json5.parse(source);
  } catch (e) {
    throw new Error(
      `editJson5: file "${filePath}" is not valid JSON5: ${e.message}`
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `editJson5: file "${filePath}" must contain a JSON5 object at the root`
    );
  }

  // Walk the path on the parsed object to obtain oldValue and validate
  // navigability. Each non-leaf segment must point to a plain object.
  let oldValue = parsed;
  for (let step = 0; step < pathSegments.length; step++) {
    const seg = pathSegments[step];
    const isLeaf = step === pathSegments.length - 1;

    if (oldValue === null || typeof oldValue !== 'object' || Array.isArray(oldValue)) {
      const pathDesc = pathSegments.slice(0, step).map(s => `"${s}"`).join(' → ') || '<root>';
      throw new Error(
        `editJson5: cannot descend past ${pathDesc} in "${filePath}" — ` +
        `value is not a plain object`
      );
    }
    if (!Object.prototype.hasOwnProperty.call(oldValue, seg)) {
      const pathDesc = pathSegments.slice(0, step + 1).map(s => `"${s}"`).join(' → ');
      throw new Error(
        `editJson5: path ${pathDesc} not found in "${filePath}". ` +
        `Adding new fields is out of scope.`
      );
    }
    oldValue = oldValue[seg];

    // Intermediate segments must be plain objects (arrays not navigable).
    if (!isLeaf) {
      if (oldValue === null || typeof oldValue !== 'object' || Array.isArray(oldValue)) {
        const pathDesc = pathSegments.slice(0, step + 1).map(s => `"${s}"`).join(' → ');
        throw new Error(
          `editJson5: cannot descend into ${pathDesc} in "${filePath}" — ` +
          `value is not a plain object (arrays and scalars are not navigable)`
        );
      }
    }
  }

  // No-op: field already has the requested value — skip write entirely.
  if (deepEqual(oldValue, newValue)) {
    return { changed: false, oldValue, newValue };
  }

  // Sostituzione per chiave (vedi replaceValueAtPath): ricorre invece di
  // ricostruire il blocco, così i commenti restano dove sono. Tutti gli splice
  // avvengono IN MEMORIA e la scrittura resta UNA — un'operazione per chiave
  // tramite le API a livello di file costerebbe N scritture e un fallimento a
  // metà lascerebbe il file parzialmente aggiornato, con ogni stato intermedio
  // valido e quindi invisibile.
  const droppedComments = [];
  const newSource = replaceValueAtPath(source, pathSegments, newValue, filePath, droppedComments);

  // Post-edit validation: must be valid JSON5 and the value at the path must
  // deep-equal newValue. Catches any case where the locator targeted an
  // unintended position.
  let parsedAfter;
  try {
    parsedAfter = json5.parse(newSource);
  } catch (e) {
    throw new Error(
      `editJson5: post-edit validation failed — result is not valid JSON5: ${e.message}`
    );
  }
  let actualNew = parsedAfter;
  for (const seg of pathSegments) {
    if (actualNew === null || typeof actualNew !== 'object') {
      actualNew = undefined;
      break;
    }
    actualNew = actualNew[seg];
  }
  if (!deepEqual(actualNew, newValue)) {
    const pathDesc = pathSegments.map(s => `"${s}"`).join(' → ');
    throw new Error(
      `editJson5: post-edit sanity check failed for path ${pathDesc} ` +
      `(internal error: replacement targeted the wrong position)`
    );
  }

  // Atomic write: saveJson5 with a string preserves the content as-is.
  await saveJson5(resolvedPath, newSource);

  return { changed: true, oldValue, newValue, droppedComments };
}

module.exports = editJson5;

// Localizzatore testuale condiviso con setJson5Key.
//
// setJson5Key deve INSERIRE una chiave dentro un oggetto annidato già esistente
// (es. `custom.dataPath` quando `custom` c'è ma la chiave no), operazione fuori
// dallo scope di editJson5 (che aggiorna soltanto). Per farlo gli serve sapere
// dove comincia il blocco `{` del parent: esattamente ciò che `locatePath`
// calcola qui, sopra una mask che distingue codice da stringhe e commenti.
//
// Esposto invece di duplicare quella logica: è la parte più delicata del modulo
// (una seconda implementazione divergerebbe in silenzio), e resta un dettaglio
// interno al core — non fa parte dell'API pubblica di editJson5.
// `_internals` è stato RIMOSSO: la scansione che esponeva vive ora in
// `core/json5Scan.js`, con una superficie pubblica. Chi la usava —
// `setJson5Key` — la importa direttamente da lì.
