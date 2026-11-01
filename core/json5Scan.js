/**
 * json5Scan — scansione testuale di un file `.json5`: dice DOV'È COSA.
 *
 * ─── COS'E, E COSA NON E ──────────────────────────────────────────────────────
 * Modulo di SOLA LETTURA. Non modifica niente, non scrive niente, non conosce il
 * filesystem: riceve una stringa e restituisce posizioni. Tutto ciò che in questo
 * progetto cambia un `.json5` preservandone i commenti poggia su queste funzioni.
 *
 * ─── PERCHE ESISTE ────────────────────────────────────────────────────────────
 * La libreria `json5` perde i commenti nel round-trip, ed è normale: un parser
 * produce valori, e i commenti non sono valori. Ma nei config di ital8cms i
 * commenti SONO la documentazione, quindi le modifiche non possono passare per
 * parse+stringify — vanno fatte sul TESTO, lasciando intatto tutto ciò che non si
 * tocca. Per farlo bisogna sapere, di ogni carattere, se è codice o se vive
 * dentro una stringa o un commento; e bisogna sapere dove FINISCE un valore, non
 * solo dove comincia la sua chiave.
 *
 * ─── PERCHE E UN MODULO A SE ──────────────────────────────────────────────────
 * Questa macchina viveva dentro `editJson5.js`, esportata come `_internals` —
 * un nome che per convenzione significa « esposto ai test ». Quando è servita a
 * un secondo modulo di produzione (`removeJson5Key`), tenerla lì avrebbe lasciato
 * un nome che dichiara il contrario di quello che fa.
 *
 * Il costo di NON averla condivisa si è già visto: la rimozione di una chiave è
 * stata riscritta a mano dentro uno script di migrazione, con `indexOf` invece di
 * `scanValue`, e ne sono usciti due difetti di perdita dati — fra cui una
 * cancellazione che su una regola scritta inline si portava via anche la regola
 * SUCCESSIVA. Non era un algoritmo difficile sbagliato: era codice già scritto
 * venti righe più in là, e non guardato.
 * → docs/decisions/json5-key-operations.it.md
 *
 * ─── LE FUNZIONI, IN ORDINE DI DIPENDENZA ─────────────────────────────────────
 *   buildCodeMask(source)                → mask[i]=1 se il carattere i è dentro
 *                                          una stringa o un commento
 *   buildDepthArray(source, mask)        → profondità di annidamento a ogni
 *                                          posizione, contando solo il codice
 *   skipWsAndCommentsForward/Backward    → navigazione che ignora spazi e commenti
 *   scanValue(source, mask, start)       → dove FINISCE il valore che inizia a
 *                                          `start` (scalare, oggetto, array)
 *   findKeyOccurrencesInRegion(...)      → le occorrenze di una chiave in una
 *                                          regione, a una profondità attesa
 *   locatePath(source, mask, depth, ...) → cammina un path e ritorna
 *                                          { keyStart, keyEnd, valueStart, valueEnd }
 *
 * `locatePath` è la porta d'ingresso: la span `keyStart … valueEnd` è ciò che
 * `editJson5` sostituisce e ciò che `removeJson5Key` toglie.
 *
 * ─── GARANZIE ─────────────────────────────────────────────────────────────────
 *   - le graffe e le parentesi dentro le STRINGHE non contano (`"regex:\\d{1,3}"`
 *     non altera la profondità): è `buildCodeMask` a renderlo vero;
 *   - un path AMBIGUO fa lanciare: se un segmento compare più volte alla
 *     profondità attesa, `locatePath` rifiuta invece di scegliere. Modificare o
 *     cancellare la chiave sbagliata è peggio che non farlo.
 *
 * @module core/json5Scan
 */

'use strict';

// ── Pre-scan: build a "code mask" identifying chars inside strings/comments ──
//
// mask[i] === 1 means: char at i is INSIDE a string body or anywhere within a
// comment (markers + body). String delimiter quotes themselves remain mask=0
// (they are structural tokens we want to find). This lets us safely look for
// `:`, `{`, `,` in code while ignoring punctuation that lives inside strings
// or comments.

function buildCodeMask(source) {
  const n = source.length;
  const mask = new Uint8Array(n);
  let i = 0;

  while (i < n) {
    const c = source[i];
    const next = i + 1 < n ? source[i + 1] : '';

    // Single-line comment // …
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        mask[i] = 1;
        i++;
      }
      continue;
    }

    // Multi-line comment /* … */
    if (c === '/' && next === '*') {
      mask[i] = 1; mask[i + 1] = 1;
      i += 2;
      while (i < n) {
        if (source[i] === '*' && i + 1 < n && source[i + 1] === '/') {
          mask[i] = 1; mask[i + 1] = 1;
          i += 2;
          break;
        }
        mask[i] = 1;
        i++;
      }
      continue;
    }

    // String — quotes stay code (mask=0), contents are masked
    if (c === '"' || c === "'") {
      const quote = c;
      i++; // opening quote stays mask=0
      while (i < n) {
        if (source[i] === '\\' && i + 1 < n) {
          mask[i] = 1; mask[i + 1] = 1;
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          // closing quote stays mask=0
          i++;
          break;
        }
        mask[i] = 1;
        i++;
      }
      continue;
    }

    i++;
  }

  return mask;
}

// ── Build depth array — brace/bracket nesting at each position ──────────────
// At a `{` or `[`, depth[i] holds the depth BEFORE that bracket.
// At a `}` or `]`, depth[i] holds the depth AFTER decrement.
// Other positions hold the active depth at that point.

function buildDepthArray(source, mask) {
  const n = source.length;
  const depth = new Int32Array(n);
  let d = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i] !== 0) {
      depth[i] = d;
      continue;
    }
    const c = source[i];
    if (c === '{' || c === '[') {
      depth[i] = d;
      d++;
    } else if (c === '}' || c === ']') {
      d--;
      depth[i] = d;
    } else {
      depth[i] = d;
    }
  }
  return depth;
}

// ── Skip whitespace and comments forward/backward ────────────────────────────

function skipWsAndCommentsForward(source, mask, start) {
  let i = start;
  const n = source.length;
  while (i < n) {
    if (mask[i] !== 0) { i++; continue; }
    if (/\s/.test(source[i])) { i++; continue; }
    break;
  }
  return i;
}

function skipWsAndCommentsBackward(source, mask, start) {
  let i = start;
  while (i >= 0) {
    if (mask[i] !== 0) { i--; continue; }
    if (/\s/.test(source[i])) { i--; continue; }
    break;
  }
  return i;
}

// ── Scan a value starting at `start`, return end position (exclusive) ───────
// Supports: string ("..." or '...'), boolean, null, number (incl. JSON5
// extensions: hex, +/-Infinity, NaN, leading/trailing decimal points, signs),
// object {...} and array [...] (both with arbitrary nested content, comments,
// strings).
//
// The `mask` is used for container scanning so that brackets inside strings
// or comments do not affect the matching.

function scanValue(source, mask, start) {
  const n = source.length;
  if (start >= n) return -1;
  const c = source[start];

  // String literal
  if (c === '"' || c === "'") {
    const quote = c;
    let j = start + 1;
    while (j < n) {
      if (source[j] === '\\' && j + 1 < n) { j += 2; continue; }
      if (source[j] === quote) return j + 1;
      j++;
    }
    return -1; // unterminated
  }

  // Object / array — scan for matching closing bracket using the mask to
  // ignore brackets inside strings and comments. Both bracket types are
  // counted together for nesting depth; the value ends when we see a closing
  // bracket at nesting depth 0, which must match our opening type.
  if (c === '{' || c === '[') {
    const close = c === '{' ? '}' : ']';
    let nestedDepth = 0;
    let j = start + 1;
    while (j < n) {
      if (mask[j] !== 0) { j++; continue; }
      const ch = source[j];
      if (ch === '{' || ch === '[') {
        nestedDepth++;
      } else if (ch === '}' || ch === ']') {
        if (nestedDepth === 0) {
          // This must be our closing bracket; mismatch indicates malformed
          // input (will also be caught by the post-edit json5.parse).
          if (ch === close) return j + 1;
          return -1;
        }
        nestedDepth--;
      }
      j++;
    }
    return -1; // unterminated
  }

  // Boolean / null — verify followed by a non-identifier char to avoid
  // matching `trueish` or `nullable`
  function matchKeyword(kw) {
    if (!source.startsWith(kw, start)) return false;
    const after = start + kw.length;
    if (after >= n) return true;
    return !/[A-Za-z0-9_$]/.test(source[after]);
  }
  if (matchKeyword('true')) return start + 4;
  if (matchKeyword('false')) return start + 5;
  if (matchKeyword('null')) return start + 4;

  // Number — JSON5 numeric literal
  const numMatch = source
    .substring(start)
    .match(
      /^[+-]?(?:Infinity|NaN|0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/
    );
  if (numMatch && numMatch[0].length > 0) {
    return start + numMatch[0].length;
  }

  // Unrecognized
  return -1;
}

// ── Find all occurrences of a key inside a region at a given depth ──────────
//
// Generalized locator: scans `source[regionStart..regionEnd)` looking for a
// key matching `fieldName` whose position has `depth[pos] === expectedDepth`.
// At root, region = whole file and expectedDepth = 1. For nested paths, the
// region is constrained to the parent block's value range and expectedDepth
// is incremented at each descent step.

function findKeyOccurrencesInRegion(source, mask, depth, fieldName, regionStart, regionEnd, expectedDepth) {
  const occurrences = [];
  let i = regionStart;

  while (i < regionEnd) {
    if (mask[i] !== 0) { i++; continue; }

    let keyStart = -1;
    let keyEnd = -1;

    // Quoted key (single or double)
    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i];
      let j = i + 1;
      while (j < regionEnd) {
        if (source[j] === '\\' && j + 1 < regionEnd) { j += 2; continue; }
        if (source[j] === quote) break;
        j++;
      }
      if (j >= regionEnd) { i++; continue; } // unterminated within region
      const content = source.substring(i + 1, j);
      if (content === fieldName) {
        keyStart = i;
        keyEnd = j + 1;
      } else {
        i = j + 1;
        continue;
      }
    }
    // Unquoted identifier (JSON5)
    else if (/[A-Za-z_$]/.test(source[i])) {
      let j = i;
      while (j < regionEnd && mask[j] === 0 && /[A-Za-z0-9_$]/.test(source[j])) j++;
      const ident = source.substring(i, j);
      if (ident === fieldName) {
        keyStart = i;
        keyEnd = j;
      } else {
        i = j;
        continue;
      }
    } else {
      i++;
      continue;
    }

    // Must be at the expected depth (filter out matches at deeper nesting)
    if (depth[keyStart] !== expectedDepth) {
      i = keyEnd;
      continue;
    }

    // Position context: must be preceded (after ws/comments) by `{` or `,`,
    // ruling out occurrences in unexpected positions (e.g. inside array
    // literals, after a stray identifier, etc.).
    const prev = skipWsAndCommentsBackward(source, mask, keyStart - 1);
    if (prev < 0 || (source[prev] !== '{' && source[prev] !== ',')) {
      i = keyEnd;
      continue;
    }

    // Find colon
    const colonPos = skipWsAndCommentsForward(source, mask, keyEnd);
    if (colonPos >= regionEnd || source[colonPos] !== ':') {
      i = keyEnd;
      continue;
    }

    // Find value start
    const valueStart = skipWsAndCommentsForward(source, mask, colonPos + 1);
    if (valueStart >= regionEnd) {
      i = keyEnd;
      continue;
    }

    // Scan value (scalar, object, or array)
    const valueEnd = scanValue(source, mask, valueStart);
    if (valueEnd === -1 || valueEnd > regionEnd) {
      throw new Error(
        `editJson5: field "${fieldName}" found at depth ${expectedDepth} but ` +
        `its value could not be parsed (malformed or unsupported value form)`
      );
    }

    occurrences.push({ keyStart, keyEnd, valueStart, valueEnd });
    i = valueEnd;
  }

  return occurrences;
}

// ── Walk a path of segments, returning the leaf occurrence ──────────────────

function locatePath(source, mask, depth, pathSegments, filePath) {
  let regionStart = 0;
  let regionEnd = source.length;
  let expectedDepth = 1;
  let lastOcc = null;

  for (let step = 0; step < pathSegments.length; step++) {
    const segment = pathSegments[step];
    const occs = findKeyOccurrencesInRegion(
      source, mask, depth, segment, regionStart, regionEnd, expectedDepth
    );

    if (occs.length === 0) {
      const pathDesc = pathSegments.slice(0, step + 1).map(s => `"${s}"`).join(' → ');
      throw new Error(
        `editJson5: path ${pathDesc} not found in "${filePath}" ` +
        `(parsed but locator failed — likely an unsupported JSON5 feature)`
      );
    }
    if (occs.length > 1) {
      const pathDesc = pathSegments.slice(0, step + 1).map(s => `"${s}"`).join(' → ');
      throw new Error(
        `editJson5: path ${pathDesc} appears ${occs.length} times in "${filePath}" ` +
        `(duplicate keys at the same depth). Refusing to edit ambiguously.`
      );
    }

    lastOcc = occs[0];

    // Last segment: leaf reached, return its occurrence
    if (step === pathSegments.length - 1) break;

    // Intermediate: must descend into an object literal
    const valChar = source[lastOcc.valueStart];
    if (valChar !== '{') {
      const pathDesc = pathSegments.slice(0, step + 1).map(s => `"${s}"`).join(' → ');
      throw new Error(
        `editJson5: cannot descend into ${pathDesc} in "${filePath}" — ` +
        `value is not a plain object (arrays and scalars are not navigable)`
      );
    }

    // Constrain next iteration to the inside of this object block
    regionStart = lastOcc.valueStart + 1; // after `{`
    regionEnd = lastOcc.valueEnd - 1;     // before `}`
    expectedDepth++;
  }

  return lastOcc;
}

// ── Span da rimuovere: la coppia più i commenti che le appartengono ─────────
//
// È ANALISI, non modifica: ritorna due indici e non tocca il testo. Vive qui
// perché « dove intervenire » è una domanda di lettura, mentre lo splice è una
// scrittura e resta negli editor. Così `removeJson5Key` e la sostituzione per
// chiave di `editJson5` condividono un solo criterio invece di tenerne due
// d'accordo.
//
// LA POLICY, IN UNA FRASE: risalendo dalla riga della chiave appartiene a lei
// ogni riga composta SOLO da un commento; si ferma alla prima riga vuota o che
// contiene codice. In discesa: la virgola strutturale, il commento in linea che
// la segue, e il fine riga.
// → docs/decisions/json5-key-operations.it.md (D2)

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
 * La span di testo da rimuovere per far sparire una coppia chiave-valore.
 *
 * @param {string} source
 * @param {Int8Array|number[]} mask - da `buildCodeMask`
 * @param {{keyStart: number, valueEnd: number}} occ - da `locatePath`
 * @returns {{from: number, to: number}} indici per `source.slice(0, from) + source.slice(to)`
 */
function findRemovalSpan(source, mask, occ) {
  return {
    from: extendUpwards(source, occ.keyStart),
    to: extendDownwards(source, mask, occ.valueEnd),
  };
}

// ── Punto d'inserimento di una chiave nuova ─────────────────────────────────
//
// Gemella di `findRemovalSpan`, e anche questa è ANALISI: ritorna un offset,
// l'indentazione da usare e se serve una virgola prima. Lo splice resta al
// chiamante.
//
// Unifica due meccanismi che `setJson5Key` teneva separati: l'inserimento
// top-level lavorava per RIGHE (`split('\n')`, `findIndex`, `splice`) e quello
// annidato per OFFSET. Due strade per la stessa operazione, che si comportavano
// in modo diverso — per esempio `afterKey` era onorato solo dal primo.

/**
 * Dove scrivere una chiave nuova dentro un oggetto.
 *
 * @param {string} source
 * @param {Int8Array|number[]} mask - da `buildCodeMask`
 * @param {Int32Array|number[]} depth - da `buildDepthArray`
 * @param {string[]} [parentPath] - path dell'oggetto che ospiterà la chiave;
 *   `[]` (default) significa l'oggetto RADICE.
 * @param {string|null} [afterKey] - se presente e trovata nel blocco, si
 *   inserisce subito dopo quella chiave invece che in testa al blocco.
 * @param {string} [filePath] - solo per i messaggi d'errore.
 * @returns {{offset: number, indent: string, needsComma: boolean, parentIndent: string, blockIsEmpty: boolean}}
 *   `parentIndent` e `blockIsEmpty` servono a chiudere bene un blocco che era
 *   vuoto: senza, la `}` resterebbe sulla riga della chiave appena inserita
 *   (`{ "nuova": 9,}` — valido ma illeggibile, e questi file li legge una persona).
 * @throws se il path del parent non esiste, o non è un oggetto.
 */
function findInsertionPoint(source, mask, depth, parentPath = [], afterKey = null, filePath = '<source>') {
  let openBrace;
  let blockEnd;      // indice della `}` che chiude il blocco
  let parentIndent;

  if (parentPath.length === 0) {
    // Oggetto radice: la prima `{` che è CODICE (non dentro una stringa o un
    // commento — un file che comincia con l'intestazione `// …` ne ha una prima).
    openBrace = -1;
    for (let i = 0; i < source.length; i += 1) {
      if (source[i] === '{' && mask[i] === 0) { openBrace = i; break; }
    }
    if (openBrace === -1) {
      throw new Error(`findInsertionPoint: ${filePath} non contiene un oggetto radice`);
    }
    const end = scanValue(source, mask, openBrace);
    if (end === -1) {
      throw new Error(`findInsertionPoint: l'oggetto radice di ${filePath} non è chiuso`);
    }
    blockEnd = end - 1;
    parentIndent = '';
  } else {
    const occ = locatePath(source, mask, depth, parentPath, filePath);
    if (source[occ.valueStart] !== '{') {
      const pathDesc = parentPath.map((seg) => `"${seg}"`).join(' → ');
      throw new Error(
        `findInsertionPoint: il path ${pathDesc} in ${filePath} non è un oggetto: `
        + 'non ci si può inserire una chiave'
      );
    }
    openBrace = occ.valueStart;
    blockEnd = occ.valueEnd - 1;
    let lineStart = occ.keyStart;
    while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart -= 1;
    const raw = source.substring(lineStart, occ.keyStart);
    parentIndent = /^\s*$/.test(raw) ? raw : '';
  }

  return findInsertionPointInBlock(
    source, mask, depth, { openBrace, blockEnd, parentIndent }, afterKey, filePath
  );
}

/**
 * Lo stesso calcolo, su un blocco GIÀ individuato.
 *
 * Esiste perché non tutto ciò che ospita una chiave ha un path: un elemento
 * d'ARRAY non è raggiungibile da `parentPath` (gli indici non sono segmenti
 * validi, per contratto di `editJson5`), eppure la sostituzione per chiave deve
 * poterci scendere. Chi conosce già la span del blocco la passa qui;
 * `findInsertionPoint` è il wrapper che la ricava da un path.
 *
 * @param {{openBrace: number, blockEnd: number, parentIndent: string}} block
 *   `openBrace`: indice della `{` che apre il blocco; `blockEnd`: indice della
 *   `}` che lo chiude; `parentIndent`: indentazione della riga che lo ospita.
 * @returns {{offset: number, indent: string, needsComma: boolean, parentIndent: string, blockIsEmpty: boolean}}
 */
function findInsertionPointInBlock(source, mask, depth, block, afterKey = null, filePath = '<source>') {
  const { openBrace, blockEnd, parentIndent } = block;

  // Indentazione: ricalcata dalla prima riga non vuota DENTRO il blocco, così il
  // file resta formattato come lo si trova. Fallback: due spazi in più del parent.
  const inner = source.substring(openBrace + 1, blockEnd);
  const innerMatch = inner.match(/\n([ \t]+)\S/);
  const indent = innerMatch ? innerMatch[1] : `${parentIndent}  `;

  // Offset: in testa al blocco, oppure a fine riga di `afterKey` se la si trova.
  let offset = openBrace + 1;
  if (afterKey) {
    const occs = findKeyOccurrencesInRegion(
      source, mask, depth, afterKey, openBrace + 1, blockEnd, depth[openBrace] + 1
    );
    if (occs.length === 1) {
      // La fine della RIGA, non del valore: un commento in linea su quella riga
      // appartiene ad `afterKey` e deve restarle attaccato.
      //
      // MA la riga va CLAMPATA al blocco. Su un blocco scritto inline
      // (`"inner": { "a": 1, "b": 2 }`) la riga di `afterKey` continua OLTRE la
      // `}`, quindi inserire a fine riga metterebbe la chiave nuova FUORI
      // dall'oggetto che doveva ospitarla. Il difetto è stato colto dalla
      // postcondizione di `editJson5` — il valore al path non combaciava più —
      // e non da una lettura del codice.
      const nl = source.indexOf('\n', occs[0].valueEnd);
      if (nl !== -1 && nl <= blockEnd) {
        offset = nl;
      } else {
        // Blocco INLINE: la riga continua oltre la `}`, quindi si sta subito
        // dopo il valore — e DOPO la sua virgola, se c'è. Fermarsi prima della
        // virgola produceva `"d": 4,,`: `needsComma` guarda INDIETRO e vedeva il
        // valore, mentre la virgola stava AVANTI all'offset.
        const afterValue = skipWsAndCommentsForward(source, mask, occs[0].valueEnd);
        offset = (source[afterValue] === ',' && mask[afterValue] === 0)
          ? afterValue + 1
          : occs[0].valueEnd;
      }
    }
  }

  // Serve una virgola prima? Se l'ultimo carattere di codice davanti all'offset
  // non è `,` né l'apertura del blocco, la coppia precedente non ne ha una — e
  // senza, il file diventerebbe non parsabile. (Capita con l'ultima chiave di un
  // oggetto scritto senza virgola finale.)
  const prev = skipWsAndCommentsBackward(source, mask, offset - 1);
  const prevChar = prev >= 0 ? source[prev] : '';
  const needsComma = prev >= 0 && prevChar !== ',' && prev !== openBrace;

  return {
    offset,
    indent,
    needsComma,
    parentIndent,
    blockIsEmpty: inner.trim() === '',
  };
}

module.exports = {
  buildCodeMask,
  findRemovalSpan,
  findInsertionPoint,
  findInsertionPointInBlock,
  buildDepthArray,
  skipWsAndCommentsForward,
  skipWsAndCommentsBackward,
  scanValue,
  findKeyOccurrencesInRegion,
  locatePath,
};
