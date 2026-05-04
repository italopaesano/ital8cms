/**
 * editJson5 — Edit-by-position editor for JSON5 files.
 *
 * Modifies a single top-level field in a .json5 file while preserving all
 * comments, trailing commas, formatting, and other JSON5 features outside the
 * modified field.
 *
 * Approach:
 *   1. Parse the file with json5 to validate it and confirm the field exists.
 *   2. Pre-scan the source to identify code regions vs. strings/comments.
 *   3. Locate the field's key + scalar value at root depth (depth=1).
 *   4. Replace the matched key+value with the normalized form
 *      `"fieldName": <newValue>` where newValue is JSON-serialized.
 *   5. Validate the result by re-parsing with json5 and comparing the field.
 *   6. Write atomically via saveJson5(path, rawString).
 *
 * Scope (v1):
 *   - Field must already exist at the root level. No creation of new fields.
 *   - The OLD value must be a scalar (number, string, boolean, null).
 *     If it is an object or array, an error is thrown.
 *   - The NEW value can be any JSON-serializable value: number, string,
 *     boolean, null, object, array.
 *   - Output is normalized for the modified pair only: quoted key, single
 *     space after colon, JSON.stringify for the value with 2-space indent.
 *   - Line indentation and trailing context (commas, comments, braces)
 *     surrounding the field are preserved unchanged.
 *   - Caller is responsible for value-type semantics (no true→1 normalization).
 *
 * Out of scope (v1):
 *   - Replacing object/array values (would require bracket matching).
 *   - Nested paths via dotted notation.
 *   - Adding new fields.
 *   - Editing inside arrays/objects (push, splice, set nested key).
 *
 * Returns: Promise<{ changed, oldValue, newValue }>
 *   - changed=false if the field already had the requested value (no-op).
 *
 * Throws on:
 *   - Invalid JSON5 in the source file.
 *   - Root is not a JSON5 object.
 *   - Field not found at root.
 *   - Field appears multiple times at root (duplicate keys).
 *   - OLD value is an object or array.
 *   - NEW value is not JSON-serializable (undefined, function, BigInt, etc.).
 *   - Post-edit validation failure (parse error or value mismatch).
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');
const json5 = require('json5');
const saveJson5 = require('./saveJson5');

// ── Helpers ──────────────────────────────────────────────────────────────────

function isScalar(v) {
  return v === null || (typeof v !== 'object' && typeof v !== 'function');
}

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

// ── Scan a scalar value starting at `start`, return end position (exclusive) ─
// Supported: string ("..." or '...'), boolean, null, number (incl. JSON5
// extensions: hex, +/-Infinity, NaN, leading/trailing decimal points, signs).

function scanScalarValue(source, start) {
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

  // Object/array or unrecognized — out of scope
  return -1;
}

// ── Find all occurrences of a key at root depth (depth=1) ────────────────────

function findKeyOccurrencesAtRoot(source, mask, depth, fieldName) {
  const occurrences = [];
  const n = source.length;
  let i = 0;

  while (i < n) {
    if (mask[i] !== 0) { i++; continue; }

    let keyStart = -1;
    let keyEnd = -1;

    // Quoted key (single or double)
    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i];
      let j = i + 1;
      while (j < n) {
        if (source[j] === '\\' && j + 1 < n) { j += 2; continue; }
        if (source[j] === quote) break;
        j++;
      }
      if (j >= n) { i++; continue; } // unterminated
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
      while (j < n && mask[j] === 0 && /[A-Za-z0-9_$]/.test(source[j])) j++;
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

    // Must be at root depth (depth=1 = inside the root object)
    if (depth[keyStart] !== 1) {
      i = keyEnd;
      continue;
    }

    // Position context: must be preceded (after ws/comments) by `{` or `,`,
    // ruling out occurrences in unexpected positions.
    const prev = skipWsAndCommentsBackward(source, mask, keyStart - 1);
    if (prev < 0 || (source[prev] !== '{' && source[prev] !== ',')) {
      i = keyEnd;
      continue;
    }

    // Find colon
    const colonPos = skipWsAndCommentsForward(source, mask, keyEnd);
    if (colonPos >= n || source[colonPos] !== ':') {
      i = keyEnd;
      continue;
    }

    // Find value start
    const valueStart = skipWsAndCommentsForward(source, mask, colonPos + 1);
    if (valueStart >= n) {
      i = keyEnd;
      continue;
    }

    // Scan value (must be scalar in v1)
    const valueEnd = scanScalarValue(source, valueStart);
    if (valueEnd === -1) {
      throw new Error(
        `editJson5: field "${fieldName}" found at root but its current value ` +
        `is not a scalar (object or array). Replacing object/array values ` +
        `is out of scope for v1.`
      );
    }

    occurrences.push({ keyStart, keyEnd, valueStart, valueEnd });
    i = valueEnd;
  }

  return occurrences;
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

async function editJson5(filePath, fieldName, newValue) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('editJson5: filePath must be a non-empty string');
  }
  if (typeof fieldName !== 'string' || fieldName.length === 0) {
    throw new Error('editJson5: fieldName must be a non-empty string');
  }

  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  const source = await fs.readFile(resolvedPath, 'utf8');

  // High-level validation: file must be valid JSON5 with a root object that
  // contains fieldName.
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
  if (!Object.prototype.hasOwnProperty.call(parsed, fieldName)) {
    throw new Error(
      `editJson5: field "${fieldName}" not found at root in "${filePath}". ` +
      `Adding new fields is out of scope for v1.`
    );
  }

  const oldValue = parsed[fieldName];
  if (!isScalar(oldValue)) {
    throw new Error(
      `editJson5: field "${fieldName}" in "${filePath}" currently holds an ` +
      `object or array. Replacing object/array values is out of scope for v1.`
    );
  }

  // No-op: field already has the requested value — skip write entirely.
  if (deepEqual(oldValue, newValue)) {
    return { changed: false, oldValue, newValue };
  }

  // Locate the key+value in the raw source for surgical replacement.
  const mask = buildCodeMask(source);
  const depth = buildDepthArray(source, mask);
  const occurrences = findKeyOccurrencesAtRoot(source, mask, depth, fieldName);

  if (occurrences.length === 0) {
    // Sanity: parser saw the field but the locator did not. Indicates either
    // a bug in the locator or a JSON5 feature it doesn't recognize.
    throw new Error(
      `editJson5: field "${fieldName}" parsed successfully but could not be ` +
      `located in source for editing (internal error)`
    );
  }
  if (occurrences.length > 1) {
    throw new Error(
      `editJson5: field "${fieldName}" appears ${occurrences.length} times ` +
      `at root in "${filePath}" (duplicate keys). Refusing to edit ambiguously.`
    );
  }

  const { keyStart, valueEnd } = occurrences[0];

  // Compute base indentation: the whitespace from the previous newline up to
  // the field's key. Used to align multi-line new values (objects/arrays).
  let lineStart = keyStart;
  while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart--;
  const indentRaw = source.substring(lineStart, keyStart);
  const baseIndent = /^\s*$/.test(indentRaw) ? indentRaw : '';

  const newValueText = formatNewValue(newValue, baseIndent);
  const replacement = `"${fieldName}": ${newValueText}`;

  const newSource =
    source.substring(0, keyStart) +
    replacement +
    source.substring(valueEnd);

  // Post-edit validation: must be valid JSON5 and the field's value must
  // deep-equal newValue. This catches any case where the locator might have
  // targeted an unintended position.
  let parsedAfter;
  try {
    parsedAfter = json5.parse(newSource);
  } catch (e) {
    throw new Error(
      `editJson5: post-edit validation failed — result is not valid JSON5: ${e.message}`
    );
  }
  if (!deepEqual(parsedAfter[fieldName], newValue)) {
    throw new Error(
      `editJson5: post-edit sanity check failed for field "${fieldName}" ` +
      `(internal error: replacement targeted the wrong position)`
    );
  }

  // Atomic write: saveJson5 with a string preserves the content as-is.
  await saveJson5(resolvedPath, newSource);

  return { changed: true, oldValue, newValue };
}

module.exports = editJson5;
