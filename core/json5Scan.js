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

module.exports = {
  buildCodeMask,
  buildDepthArray,
  skipWsAndCommentsForward,
  skipWsAndCommentsBackward,
  scanValue,
  findKeyOccurrencesInRegion,
  locatePath,
};
