/**
 * editJson5 — editor per posizione di file `.json5`.
 *
 * Modifica un singolo campo (top-level o annidato) preservando commenti,
 * virgole finali, formattazione e ogni altra caratteristica JSON5 di tutto ciò
 * che non viene toccato.
 *
 * ─── COME PROCEDE ─────────────────────────────────────────────────────────────
 *   1. Parsa il file con json5 per validarlo e confermare che il path esista.
 *   2. Scansiona il testo (`json5Scan`): dove è codice, dove stringa o commento,
 *      la profondità di annidamento, dove finisce ogni valore.
 *   3. Cammina il path e localizza la foglia.
 *   4. Sostituisce RICORRENDO, non rifacendo il blocco (vedi sotto).
 *   5. Valida il risultato ri-parsando e confrontando il valore al path.
 *   6. Scrive atomicamente via `saveJson5`, UNA volta sola.
 *
 * ─── SOSTITUZIONE PER CHIAVE: LA PARTE CHE CONTA ──────────────────────────────
 * Fino alla v3.32.0 il passo 4 sostituiva il BLOCCO intero con il valore
 * riserializzato, e con esso spariva ogni commento che ci stava dentro —
 * compresi quelli di chiavi il cui valore NON cambiava. Era dichiarato come
 * limite in questa stessa intestazione, ma non era un limite tecnico: le chiavi
 * danno IDENTITÀ, quindi si sa esattamente a chi appartiene ogni commento.
 *
 * Misurato: su `{status: 429, retryAfter: 60, maxHits: 5}`, cambiando SOLO
 * `retryAfter`, sparivano anche le spiegazioni di `status` e `maxHits`. Riscrivere
 * `"status": 429` in `"status": 429` e nel farlo cancellare il perché di quel 429
 * è danno gratuito.
 *
 * La realizzazione di « conserva i commenti » è NON RICOSTRUIRE: se il blocco di
 * testo non viene rifatto, i commenti non vanno spostati — e quindi non si
 * possono spostare male.
 *
 *   | vecchio → nuovo                  | strategia            | commenti        |
 *   |----------------------------------|----------------------|-----------------|
 *   | oggetto → oggetto                | ricorre per CHIAVE   | restano         |
 *   | array → array, stessa lunghezza  | ricorre per INDICE   | restano         |
 *   | array → array, lunghezza diversa | blocco rifatto       | `droppedComments` |
 *   | cambio di tipo                   | blocco rifatto       | `droppedComments` |
 *
 * La ricorsione NON si ferma al primo livello: un elemento d'array che è a sua
 * volta un oggetto viene percorso per chiave, e così via in profondità. Il motore
 * è `replaceValueInSpan`, che lavora su un INTERVALLO di testo invece che su un
 * path — ed è ciò che le permette di scendere dentro un elemento, che un path non
 * raggiunge (gli indici non sono segmenti validi). Fino alla v3.36.0 il ramo
 * array ricorreva sì per indice, ma poi RIFACEVA l'elemento cambiato come blocco:
 * i suoi commenti morivano e `droppedComments` restava vuoto, cioè la perdita
 * silenziosa che questo modulo esiste per impedire, un livello più sotto.
 *
 * Le ultime due righe della tabella non sono pigrizia: a lunghezza diversa non c'è
 * corrispondenza fra gli elementi vecchi e i nuovi, e a tipo cambiato i commenti
 * interni non hanno più niente a cui attaccarsi. In quei casi il contratto è
 * DICHIARARE invece di tacere — `droppedComments` porta il testo **e il percorso**
 * in cui stava, perché « un commento è andato perso » non è azionabile e « in
 * custom.policy » sì.
 *
 * ⚠️ La funzione NON giudica i commenti che conserva. Non valuta se un commento
 * sia ancora vero dopo la sostituzione, non li classifica e non li marca da
 * rivedere: quella è un'attività editoriale, separata e umana (decisione D3). Il
 * motivo è che sotto incertezza le due opzioni non sono simmetriche — un commento
 * obsoleto conservato è **visibile** a chi apre il file e si riscrive, uno valido
 * cancellato è **invisibile** e non si recupera.
 *
 * ─── UNA SOLA SCRITTURA ───────────────────────────────────────────────────────
 * Tutti gli splice della ricorsione avvengono in memoria. Chiamare le API a
 * livello di file una per chiave sarebbe costato N scritture, e un fallimento a
 * metà avrebbe lasciato il file parzialmente aggiornato — con ogni stato
 * intermedio JSON5 **valido**, quindi invisibile.
 *
 * ─── AMBITO ───────────────────────────────────────────────────────────────────
 *   - Il campo deve GIÀ esistere al path indicato: la creazione di campi nuovi
 *     (intermedi o foglia) è di `setJson5Key`.
 *   - Il path è una stringa (campo top-level) o un array di stringhe (annidato).
 *     Gli INDICI d'array non sono path validi — e non servono: la ricorsione per
 *     indice enumera le span degli elementi internamente, quindi il contratto
 *     pubblico resta sui soli nomi di chiave.
 *   - I segmenti intermedi devono puntare a oggetti semplici: array e scalari non
 *     sono navigabili.
 *   - Il valore VECCHIO può essere qualsiasi valore JSON5; il NUOVO qualsiasi
 *     valore JSON-serializzabile.
 *   - La normalizzazione (chiave quotata, uno spazio dopo i due punti,
 *     `JSON.stringify` con indentazione 2) si applica solo a ciò che viene
 *     effettivamente riscritto. Una chiave il cui valore non cambia non viene
 *     toccata, quindi conserva la propria formattazione.
 *   - La semantica dei tipi resta al chiamante (nessuna normalizzazione true→1).
 *
 * ─── FUORI AMBITO ─────────────────────────────────────────────────────────────
 *   - Aggiungere campi nuovi (→ `setJson5Key`) o rimuoverne (→ `removeJson5Key`).
 *   - Inserire o togliere elementi da un array (push/splice).
 *
 * ─── API ──────────────────────────────────────────────────────────────────────
 *   editJson5(filePath, fieldName, newValue)
 *   editJson5(filePath, ['parent', 'child', ...], newValue)
 *
 * Ritorna: Promise<{ changed, oldValue, newValue, droppedComments }>
 *   - `changed: false` se il campo aveva già il valore richiesto (no-op, nessuna
 *     scrittura);
 *   - `droppedComments`: array di `{ path, text }`, **vuoto** quando nulla è stato
 *     ricostruito.
 *
 * ─── LANCIA SE ────────────────────────────────────────────────────────────────
 *   - Il file non è JSON5 valido, o la radice non è un oggetto.
 *   - Il path non esiste, o un segmento intermedio manca.
 *   - Un segmento intermedio non è un oggetto semplice (array o scalare).
 *   - Un segmento compare più volte alla profondità attesa (path AMBIGUO):
 *     modificare la chiave sbagliata è peggio che non modificare.
 *   - Il valore nuovo non è JSON-serializzabile (undefined, funzione, BigInt…).
 *   - La postcondizione fallisce (parse error, o valore diverso al path). In quel
 *     caso NIENTE viene scritto — ed è il controllo che ha colto due difetti
 *     della ricorsione su blocchi scritti inline, prima che toccassero un file.
 *
 * → docs/decisions/json5-key-operations.it.md
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
  findInsertionPointInBlock,
  findKeyOccurrencesInRegion,
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
    // `mask[i] === 2` è « dentro un COMMENTO ». Con `=== 1` (il corpo di una
    // stringa) questo riconoscitore prendeva `//` o `/*` scritti DENTRO una
    // stringa per l'inizio di un commento — vedi la nota su buildCodeMask.
    if (mask[i] === 2 && (source[i] === '/' && (source[i + 1] === '/' || source[i + 1] === '*'))) {
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
 * Sostituisce il valore che occupa una SPAN, ricorrendo invece di ricostruire.
 *
 * Gemella di `findRemovalSpan` nel modo di ragionare: lavora su un INTERVALLO di
 * testo e non su un path, ed è precisamente questo che le permette di scendere
 * dentro un elemento d'ARRAY — che un path non raggiunge, perché gli indici non
 * sono segmenti validi (vedi *AMBITO*). Finché la ricorsione passava per i path,
 * un elemento cambiato veniva RIFATTO come blocco: i suoi commenti morivano, e
 * `droppedComments` restava vuoto perché nessuno li raccoglieva. La tabella qui
 * sopra prometteva il contrario.
 *
 * Il frammento `source[span.start..span.end)` è un valore COMPLETO, quindi è un
 * universo a sé: la sua `{` sta a profondità 0 e le sue chiavi a profondità 1.
 * Per questo la scansione può essere rifatta a ogni passo senza inseguire gli
 * spostamenti del testo intorno — ed è il motivo per cui la ricorsione si compone.
 *
 * @param {string} source
 * @param {{start: number, end: number, keyStart?: number}} span - l'intervallo
 *   del VALORE; `keyStart`, se c'è, dice dove comincia la chiave che lo nomina.
 *   Un elemento d'array non ne ha, e il ritorno copre allora il solo valore.
 * @param {*} oldValue - il valore che occupa la span, già deserializzato
 * @param {*} newValue
 * @param {string[]} reportPath - per i `droppedComments` e per i messaggi: dove
 *   si sta intervenendo (gli indici d'array vi entrano come numeri)
 * @param {string} filePath - per i messaggi d'errore
 * @param {Array} dropped - raccoglie i commenti non preservabili (in place)
 * @returns {string} il testo che prende il posto di
 *   `source[(span.keyStart ?? span.start)..span.end)`
 */
function replaceValueInSpan(source, span, oldValue, newValue, reportPath, filePath, dropped) {
  let fragment = source.slice(span.start, span.end);

  // Il testo della chiave, da riemettere intatto quando la ricorsione lavora.
  const keyPrefix = span.keyStart === undefined ? '' : source.slice(span.keyStart, span.start);

  // L'indentazione si misura dalla CHIAVE quando c'è — un valore nominato sta
  // sulla riga della sua chiave — altrimenti dal valore stesso, che è il caso
  // dell'elemento d'array.
  const indentEnd = span.keyStart === undefined ? span.start : span.keyStart;
  let lineStart = indentEnd;
  while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart -= 1;
  const rawIndent = source.substring(lineStart, indentEnd);
  const baseIndent = /^\s*$/.test(rawIndent) ? rawIndent : '';

  // ── Oggetto → oggetto: per chiave ─────────────────────────────────────────
  if (isPlainObject(oldValue) && isPlainObject(newValue)) {
    const newKeys = Object.keys(newValue);

    // 1. Chiavi presenti in entrambi, con valore diverso → ricorsione.
    for (const key of newKeys) {
      if (!Object.prototype.hasOwnProperty.call(oldValue, key)) continue;
      if (deepEqual(oldValue[key], newValue[key])) continue;
      const mask = buildCodeMask(fragment);
      const depth = buildDepthArray(fragment, mask);
      const occs = findKeyOccurrencesInRegion(
        fragment, mask, depth, key, 1, fragment.length - 1, 1
      );
      if (occs.length !== 1) {
        throw new Error(
          `editJson5: la chiave ${[...reportPath, key].map((p) => `"${p}"`).join(' → ')} `
          + `di "${filePath}" ${occs.length === 0
            ? 'non è localizzabile nel testo (feature JSON5 non supportata dal locator?)'
            : `compare ${occs.length} volte alla stessa profondità: rifiuto di modificare in modo ambiguo`}`
        );
      }
      fragment = fragment.substring(0, occs[0].keyStart)
        + replaceValueInSpan(
          fragment,
          { start: occs[0].valueStart, end: occs[0].valueEnd, keyStart: occs[0].keyStart },
          oldValue[key], newValue[key], [...reportPath, key], filePath, dropped
        )
        + fragment.substring(occs[0].valueEnd);
    }

    // 2. Chiavi nuove → inserimento DOPO la precedente del nuovo oggetto, così
    //    l'ordine che il chiamante ha scritto viene rispettato. Inserirle tutte
    //    in testa al blocco sarebbe più semplice e cambierebbe l'ordine.
    for (let i = 0; i < newKeys.length; i += 1) {
      const key = newKeys[i];
      if (Object.prototype.hasOwnProperty.call(oldValue, key)) continue;
      const mask = buildCodeMask(fragment);
      const depth = buildDepthArray(fragment, mask);
      const point = findInsertionPointInBlock(
        fragment, mask, depth,
        { openBrace: 0, blockEnd: fragment.length - 1, parentIndent: baseIndent },
        i > 0 ? newKeys[i - 1] : null, filePath
      );
      let insertion = `\n${point.indent}"${key}": ${formatNewValue(newValue[key], point.indent)},`;
      if (point.blockIsEmpty) insertion += `\n${point.parentIndent}`;
      fragment = fragment.substring(0, point.offset)
        + (point.needsComma ? ',' : '')
        + insertion
        + fragment.substring(point.offset);
    }

    // 3. Chiavi che non ci sono più → rimozione, con i loro commenti (D2).
    for (const key of Object.keys(oldValue)) {
      if (Object.prototype.hasOwnProperty.call(newValue, key)) continue;
      const mask = buildCodeMask(fragment);
      const depth = buildDepthArray(fragment, mask);
      const occs = findKeyOccurrencesInRegion(
        fragment, mask, depth, key, 1, fragment.length - 1, 1
      );
      if (occs.length !== 1) {
        throw new Error(
          `editJson5: la chiave da rimuovere ${[...reportPath, key].map((p) => `"${p}"`).join(' → ')} `
          + `di "${filePath}" non è localizzabile in modo univoco (${occs.length} occorrenze)`
        );
      }
      const removal = findRemovalSpan(fragment, mask, occs[0]);
      fragment = fragment.substring(0, removal.from) + fragment.substring(removal.to);
    }

    return keyPrefix + fragment;
  }

  // ── Array → array di pari lunghezza: per indice ───────────────────────────
  if (Array.isArray(oldValue) && Array.isArray(newValue)
      && oldValue.length === newValue.length && oldValue.length > 0) {
    const mask = buildCodeMask(fragment);
    const spans = enumerateArrayElements(fragment, mask, 0, fragment.length);
    if (spans.length === oldValue.length) {
      // A ritroso: così lo splice di un elemento non sposta gli offset di quelli
      // che restano da fare, e non serve rifare la scansione a ogni giro.
      for (let i = spans.length - 1; i >= 0; i -= 1) {
        if (deepEqual(oldValue[i], newValue[i])) continue;
        fragment = fragment.substring(0, spans[i].start)
          + replaceValueInSpan(
            fragment, spans[i], oldValue[i], newValue[i],
            [...reportPath, String(i)], filePath, dropped
          )
          + fragment.substring(spans[i].end);
      }
      return keyPrefix + fragment;
    }
    // Le span contate non corrispondono alla lunghezza dell'array: non si
    // indovina, si ricade sulla sostituzione del blocco qui sotto.
  }

  // ── Fallback: sostituzione del blocco ─────────────────────────────────────
  //
  // Qui il blocco si RIFA, quindi i commenti che ci stavano dentro non hanno
  // più niente a cui attaccarsi: si DICHIARANO invece di tacerli.
  // Solo un CONTENITORE può aver ospitato commenti. Su uno scalare la raccolta
  // non è soltanto inutile: è dannosa, perché il riconoscitore guarda `mask`, che
  // marca anche il contenuto delle stringhe — e una stringa come `"/admin/**"`
  // verrebbe riportata come un commento perduto che non è mai esistito.
  if (isPlainObject(oldValue) || Array.isArray(oldValue)) {
    const mask = buildCodeMask(fragment);
    for (const text of collectCommentsIn(fragment, mask, 0, fragment.length)) {
      dropped.push({ path: [...reportPath], text });
    }
  }

  const formatted = formatNewValue(newValue, baseIndent);
  // La chiave viene riscritta in forma normalizzata SOLO qui, dove il valore è
  // davvero rifatto: è il comportamento storico del modulo, presidiato da due
  // test (`isInstalled: 0` → `"isInstalled": 1`). Nei rami che ricorrono la
  // chiave non si tocca, perché « la formattazione delle parti non toccate non
  // è normalizzata ».
  if (span.keyStart === undefined) return formatted;
  return `"${reportPath[reportPath.length - 1]}": ${formatted}`;
}

/**
 * Sostituisce il valore a un path: risolve il path in una span e delega.
 */
function replaceValueAtPath(source, pathSegments, newValue, filePath, dropped) {
  const oldValue = readAtPath(json5.parse(source), pathSegments);
  const mask = buildCodeMask(source);
  const depth = buildDepthArray(source, mask);
  const occ = locatePath(source, mask, depth, pathSegments, filePath);

  return source.substring(0, occ.keyStart)
    + replaceValueInSpan(
      source,
      { start: occ.valueStart, end: occ.valueEnd, keyStart: occ.keyStart },
      oldValue, newValue, pathSegments, filePath, dropped
    )
    + source.substring(occ.valueEnd);
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
