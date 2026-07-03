/**
 * PATH CANONICALIZER — Utility di sistema per la canonicalizzazione dei path URL.
 *
 * Fonte unica della logica di normalizzazione dei path, condivisa dai due layer
 * che difendono ital8cms dal "path/URL normalization mismatch" (audit sicurezza,
 * voce #1 — bypass del controllo accessi admin via path non canonico):
 *
 *   • Layer A (OBBLIGATORIO) — la guardia di adminAccessControl usa
 *     `canonicalizePath()` su `ctx.path` PRIMA del pattern-matching, così la
 *     regola (es. `/admin/**`) matcha anche quando il path arriva in forma non
 *     pulita (`/./admin/...`, `/x/../admin/...`, `//admin/...`). Senza questo, la
 *     guardia decide su una rappresentazione diversa da quella con cui il file
 *     server statico risolve il file → bypass.
 *
 *   • Layer B (OPZIONALE, default on) — un gate globale early usa
 *     `isCanonicalPath()` per RIFIUTARE con 400 le richieste il cui path non è già
 *     canonico. Abilitato/disabilitato da `ital8Config.json5 → rejectNonCanonicalPaths`.
 *
 * INVARIANTE DI SICUREZZA: A è sempre attiva e chiude la vulnerabilità da sola;
 * B è difesa in profondità aggiuntiva. Disattivare B NON riapre il bypass.
 *
 * NOTA: la canonicalizzazione qui è puramente sintattica e NON decodifica le
 * percent-encoding (non "indovina" la semantica del file server). Le forme
 * percent-encoded ambigue (`%2e`, `%2f`, `%5c`) sono trattate come non-canoniche
 * da `isCanonicalPath()` (→ rifiutate da B), non normalizzate da A.
 *
 * @module core/pathCanonicalizer
 */

const path = require('path');

// Caratteri di controllo (NUL 0x00 .. 0x1f + DEL 0x7f): mai legittimi in un path.
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/**
 * Restituisce la forma canonica di un path URL: collassa gli slash duplicati e
 * risolve i segmenti `.` e `..` con semantica POSIX assoluta (i `..` non possono
 * risalire oltre la radice). Non decodifica le percent-encoding e preserva
 * l'eventuale slash finale.
 *
 * Esempi:
 *   canonicalizePath('/./admin/x')        → '/admin/x'
 *   canonicalizePath('/x/../admin/x')     → '/admin/x'
 *   canonicalizePath('//admin//x')        → '/admin/x'
 *   canonicalizePath('/admin/../../etc')  → '/etc'      (non risale oltre la root)
 *   canonicalizePath('/admin/')           → '/admin/'   (slash finale preservato)
 *
 * @param {string} p - Path da canonicalizzare (tipicamente `ctx.path`).
 * @returns {string} - Il path in forma canonica (invariato se input non stringa/vuoto).
 */
function canonicalizePath(p) {
  if (typeof p !== 'string' || p === '') return p;

  // 1) Collassa gli slash duplicati. Va fatto PRIMA di path.posix.normalize
  //    perché quest'ultimo, per regola POSIX, preserva il doppio slash iniziale
  //    ('//admin' resterebbe '//admin').
  let s = p.replace(/\/{2,}/g, '/');

  // 2) Risolvi i dot-segment ('.' e '..') con semantica assoluta.
  const hadTrailingSlash = s.length > 1 && s.endsWith('/');
  s = path.posix.normalize(s);

  // 3) path.posix.normalize può eliminare lo slash finale in alcuni casi:
  //    ripristinalo se era presente nell'input (dopo il collasso).
  if (hadTrailingSlash && !s.endsWith('/')) s += '/';

  return s;
}

/**
 * Predicato: `true` se il path è già in forma canonica e privo di sequenze
 * ambigue/pericolose; `false` se contiene dot-segment (`.`/`..`), slash doppi
 * (`//`), backslash (`\`), percent-encoding ambigue (`%2e`, `%2f`, `%5c`, `%00`)
 * o caratteri di controllo. È il criterio usato dal gate B per rispondere 400.
 *
 * @param {string} p - Path da verificare (tipicamente `ctx.path`).
 * @returns {boolean} - `true` se canonico e sicuro, `false` altrimenti.
 */
function isCanonicalPath(p) {
  if (typeof p !== 'string' || p === '') return true; // niente da rifiutare

  // Backslash: mai legittimo in un path URL, spesso usato per aggirare i filtri.
  if (p.includes('\\')) return false;

  // Percent-encoding di punto/slash/backslash/NUL: forme usate per nascondere
  // dot-segment o separatori al pattern-matching (case-insensitive).
  if (/%2e|%2f|%5c|%00/i.test(p)) return false;

  // Caratteri di controllo (incluso NUL e DEL): mai legittimi in un path.
  // NOTA: lo spazio (0x20) è FUORI da questo range e quindi PASSA — sia
  // percent-encoded (%20) sia letterale, sia nei nomi di FILE sia nei nomi di
  // CARTELLA (es. "/my folder/report final.pdf"). I file/cartelle con spazi non
  // vanno mai rifiutati. Anche la query string non è coinvolta: il gate opera su
  // ctx.path, non su ctx.url.
  if (CONTROL_CHARS.test(p)) return false;

  // Dot-segment e slash doppi: se la forma canonica differisce, il path non era
  // canonico.
  if (p !== canonicalizePath(p)) return false;

  return true;
}

module.exports = { canonicalizePath, isCanonicalPath };
