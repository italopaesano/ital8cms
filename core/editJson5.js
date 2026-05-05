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

  // Locate the key+value in the raw source for surgical replacement.
  const mask = buildCodeMask(source);
  const depth = buildDepthArray(source, mask);
  const occ = locatePath(source, mask, depth, pathSegments, filePath);

  const { keyStart, valueEnd } = occ;

  // Compute base indentation: the whitespace from the previous newline up to
  // the field's key. Used to align multi-line new values (objects/arrays).
  let lineStart = keyStart;
  while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart--;
  const indentRaw = source.substring(lineStart, keyStart);
  const baseIndent = /^\s*$/.test(indentRaw) ? indentRaw : '';

  // The replacement uses the LAST segment as the (always-quoted) key name.
  const leafKey = pathSegments[pathSegments.length - 1];
  const newValueText = formatNewValue(newValue, baseIndent);
  const replacement = `"${leafKey}": ${newValueText}`;

  const newSource =
    source.substring(0, keyStart) +
    replacement +
    source.substring(valueEnd);

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

  return { changed: true, oldValue, newValue };
}

module.exports = editJson5;
