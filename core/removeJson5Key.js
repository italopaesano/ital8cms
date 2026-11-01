/**
 * removeJson5Key — rimuove una chiave da un file `.json5` preservando i commenti,
 * la formattazione e le virgole finali di tutto ciò che non si tocca.
 *
 * ─── LA QUINTA OPERAZIONE ─────────────────────────────────────────────────────
 * Lo strato di chirurgia testuale del core copriva quattro operazioni su cinque:
 * leggere (`loadJson5`), riscrivere tutto (`saveJson5`, che perde i commenti),
 * aggiornare una chiave (`editJson5`), aggiungere-o-aggiornare (`setJson5Key`).
 * Rimuovere una chiave non c'era — ed è la più difficile delle cinque, perché
 * deve capire dove FINISCE un valore e non solo dove comincia la sua chiave.
 *
 * Il costo della sua assenza si è già pagato: la rimozione era stata riscritta a
 * mano dentro uno script di migrazione, con `indexOf` invece di `scanValue`, e ne
 * sono usciti due difetti di perdita dati. Il peggiore: su una regola scritta
 * INLINE la cancellazione si portava via anche la regola SUCCESSIVA, perché
 * cercava « la prima riga di chiusura dopo la chiave » invece della chiusura di
 * quella chiave. Misurato: 8 regole diventate 3 invece di 4, con un marcatore di
 * sicurezza sparito e il file ancora parsabile, quindi nessun errore.
 * → docs/decisions/json5-key-operations.it.md
 *
 * ─── COSA SE NE VA CON LA CHIAVE (D2) ─────────────────────────────────────────
 * Una regola sola: risalendo dalla riga della chiave, appartiene a lei ogni riga
 * **composta solo da un commento**; si ferma alla prima riga **vuota** o che
 * contiene **codice**. Più, in discesa, la virgola e il commento in linea che la
 * seguono.
 *
 *   "userProfile": { … },   // nota di userProfile   ← riga CON codice: FERMA
 *   "login": { … },                                  ← la nota resta a userProfile
 *
 *   // Pagina di login (deve essere pubblica,
 *   // o nessuno potrebbe autenticarsi)              ← entrambe se ne vanno
 *   "login": { … },         // varco pubblico        ← anche questa
 *
 * La fermata sulla riga vuota non è un dettaglio: nei config del progetto una
 * riga vuota separa la documentazione di SEZIONE da quella della singola chiave.
 * Senza, rimuovendo una regola di `accessControl.json5` se ne andrebbero 10 righe
 * invece di 1, fra cui la spiegazione valida per tutte le regole vicine.
 *
 * ─── COSA NON SI AZZARDA ──────────────────────────────────────────────────────
 *   - un blocco `/* … *\/` su PIÙ righe sopra la chiave NON viene preso: portarne
 *     via una parte produrrebbe un file non più parsabile, e il progetto usa `//`
 *     in tutti i suoi config. Resta dov'è — orfano ma inerte, che è la direzione
 *     di fallimento giusta;
 *   - un path AMBIGUO fa lanciare (eredita la severità di `locatePath`):
 *     cancellare la chiave sbagliata è peggio che non cancellare;
 *   - la postcondizione verifica che la chiave sia sparita E che TUTTO IL RESTO
 *     del documento sia identico. Se non lo è, non si scrive.
 *
 * ─── CHIAVE ASSENTE: NO-OP, NON ERRORE ────────────────────────────────────────
 * A differenza di `editJson5`, che lancia su un path inesistente. Le migrazioni
 * devono essere idempotenti: alla seconda esecuzione la chiave non c'è più, e
 * quello è il risultato atteso, non un guasto.
 *
 * @module core/removeJson5Key
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
 * L'indice di inizio della riga che contiene `pos`.
 */
function lineStartOf(source, pos) {
  let i = pos;
  while (i > 0 && source[i - 1] !== '\n') i -= 1;
  return i;
}

/**
 * Una riga è « solo un commento »?
 *
 * Conservativa di proposito: accetta una riga di commento `//` e un blocco
 * `/* … *\/` COMPLETO su una riga. Un blocco aperto e non chiuso sulla stessa
 * riga non qualifica — vedi *COSA NON SI AZZARDA* nell'intestazione.
 */
function isCommentOnlyLine(lineText) {
  const trimmed = lineText.trim();
  if (trimmed === '') return false;                      // vuota: FERMA (D2)
  if (trimmed.startsWith('//')) return true;
  if (trimmed.startsWith('/*') && trimmed.endsWith('*/') && trimmed.length >= 4) return true;
  return false;
}

/**
 * Estende la span verso l'ALTO secondo D2: le righe di solo commento che
 * precedono la chiave, fermandosi alla prima riga vuota o con codice.
 */
function extendUpwards(source, keyStart) {
  let from = lineStartOf(source, keyStart);

  // Se fra l'inizio della riga e la chiave c'è altro che spazi, la chiave non è
  // la prima cosa della riga (`"a": 1, "b": 2` su una riga): non si risale, e si
  // parte dalla chiave stessa per non toccare ciò che le sta accanto.
  if (!/^[ \t]*$/.test(source.slice(from, keyStart))) return keyStart;

  while (from > 0) {
    const prevLineStart = lineStartOf(source, from - 1);
    const prevLine = source.slice(prevLineStart, from - 1); // senza il \n
    if (!isCommentOnlyLine(prevLine)) break;
    from = prevLineStart;
  }
  return from;
}

/**
 * Estende la span verso il BASSO: la virgola che chiude la coppia, il commento
 * in linea che la segue, e il fine riga.
 *
 * Il `mask` serve a non confondere una virgola DENTRO una stringa con quella
 * strutturale: `"k": "a,b"` finisce dopo la stringa, e la virgola da mangiare è
 * quella dopo, non quella interna.
 */
function extendDownwards(source, mask, valueEnd) {
  let to = valueEnd;

  // spazi e tab
  while (to < source.length && (source[to] === ' ' || source[to] === '\t')) to += 1;

  // la virgola strutturale, se c'è
  if (to < source.length && source[to] === ',' && mask[to] === 0) {
    to += 1;
    while (to < source.length && (source[to] === ' ' || source[to] === '\t')) to += 1;
  }

  // un commento in linea fino a fine riga (D2, caso B)
  const lineEnd = source.indexOf('\n', to);
  const restOfLine = source.slice(to, lineEnd === -1 ? source.length : lineEnd);
  if (restOfLine.trim().startsWith('//')
      || (restOfLine.trim().startsWith('/*') && restOfLine.trim().endsWith('*/'))) {
    to += restOfLine.length;
  }

  // il fine riga: si rimuovono RIGHE intere, così non resta una riga vuota
  if (to < source.length && source[to] === '\n') to += 1;
  else if (source.slice(to, to + 2) === '\r\n') to += 2;

  return to;
}

/**
 * Cammina il path su un oggetto deserializzato. Ritorna `undefined` se un
 * segmento qualsiasi non esiste — cioè se non c'è niente da rimuovere.
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

/** Cancella il path da un oggetto deserializzato (per la postcondizione). */
function deletePath(root, pathSegments) {
  let node = root;
  for (let i = 0; i < pathSegments.length - 1; i += 1) node = node[pathSegments[i]];
  delete node[pathSegments[pathSegments.length - 1]];
}

/**
 * Rimuove una chiave da un file `.json5`.
 *
 * @param {string} filePath - percorso del file
 * @param {string|string[]} fieldNameOrPath - chiave top-level, o path annidato
 * @returns {Promise<{changed: boolean, removedValue: *}>}
 *   `changed: false` se la chiave non c'era (no-op idempotente).
 * @throws se `filePath` o la chiave hanno un tipo sbagliato, se il file non è
 *   JSON5 valido, se la radice non è un oggetto, se il path è ambiguo, o se la
 *   postcondizione non regge (in quest'ultimo caso NIENTE viene scritto).
 */
async function removeJson5Key(filePath, fieldNameOrPath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('removeJson5Key: filePath must be a non-empty string');
  }

  // Normalizzazione identica a editJson5/setJson5Key: i tre fratelli accettano
  // la stessa forma di argomento, e divergere sarebbe una trappola.
  let pathSegments;
  if (typeof fieldNameOrPath === 'string') {
    if (fieldNameOrPath.length === 0) {
      throw new Error('removeJson5Key: fieldName must be a non-empty string');
    }
    pathSegments = [fieldNameOrPath];
  } else if (Array.isArray(fieldNameOrPath)) {
    if (fieldNameOrPath.length === 0) {
      throw new Error('removeJson5Key: path array must contain at least one segment');
    }
    for (const seg of fieldNameOrPath) {
      if (typeof seg !== 'string' || seg.length === 0) {
        throw new Error('removeJson5Key: every path segment must be a non-empty string');
      }
    }
    pathSegments = fieldNameOrPath;
  } else {
    throw new Error(
      'removeJson5Key: second argument must be a string (top-level field name) or '
      + 'an array of strings (nested path)'
    );
  }

  const source = await fs.readFile(filePath, 'utf8');

  let parsed;
  try {
    parsed = json5.parse(source);
  } catch (err) {
    throw new Error(`removeJson5Key: ${filePath} is not valid JSON5 — ${err.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`removeJson5Key: the root of ${filePath} is not a JSON5 object`);
  }

  // Chiave assente → no-op. Si decide sull'oggetto DESERIALIZZATO e non sul
  // testo: è l'unica fonte che risponde senza ambiguità, e costa una parse che
  // serve comunque per validare il file.
  const found = readPath(parsed, pathSegments);
  if (found === undefined) {
    return { changed: false, removedValue: undefined };
  }

  const mask = buildCodeMask(source);
  const depth = buildDepthArray(source, mask);
  // Lancia se il path è ambiguo o non localizzabile nel testo: a questo punto
  // sappiamo che esiste nell'oggetto, quindi un fallimento qui è una discrepanza
  // fra testo e struttura e non va aggirata.
  const occ = locatePath(source, mask, depth, pathSegments, filePath);

  const from = extendUpwards(source, occ.keyStart);
  const to = extendDownwards(source, mask, occ.valueEnd);
  const next = source.slice(0, from) + source.slice(to);

  // ── Postcondizione: si verifica PRIMA di scrivere ──────────────────────────
  //
  // Due controlli, e il secondo è quello che conta: non basta che la chiave sia
  // sparita, deve essere sparita SOLO lei. È la verifica che il difetto storico
  // — una cancellazione che si portava via la coppia successiva — non può
  // ripetersi in silenzio: il file sarebbe rimasto parsabile, e nessuno se ne
  // sarebbe accorto.
  let reparsed;
  try {
    reparsed = json5.parse(next);
  } catch (err) {
    throw new Error(
      `removeJson5Key: la rimozione di "${pathSegments.join('.')}" da ${filePath} `
      + `avrebbe prodotto un file non valido (${err.message}) — niente è stato scritto`
    );
  }
  if (readPath(reparsed, pathSegments) !== undefined) {
    throw new Error(
      `removeJson5Key: "${pathSegments.join('.')}" è ancora presente dopo la `
      + `rimozione in ${filePath} — niente è stato scritto`
    );
  }
  const expected = json5.parse(source);
  deletePath(expected, pathSegments);
  if (JSON.stringify(expected) !== JSON.stringify(reparsed)) {
    throw new Error(
      `removeJson5Key: la rimozione di "${pathSegments.join('.')}" da ${filePath} `
      + 'avrebbe cambiato anche altro nel documento — niente è stato scritto'
    );
  }

  await saveJson5(filePath, next);
  return { changed: true, removedValue: found.value };
}

module.exports = removeJson5Key;
