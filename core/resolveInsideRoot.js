/**
 * RESOLVE INSIDE ROOT — un percorso dentro una radice, o niente
 *
 * Risolve un percorso relativo dentro una directory radice e restituisce `null`
 * se il risultato ne uscirebbe. Un solo posto per un controllo che il progetto
 * aveva in due versioni, una giusta e una sbagliata (REVIEW.md → B5).
 *
 * ─── LA FORMA SBAGLIATA, E PERCHÉ INGANNA ────────────────────────────────────
 * `plugins/admin/pagesManagment.js` faceva:
 *
 *     return path.normalize(path.join(wwwPath, filePath)).startsWith(wwwPath);
 *
 * `startsWith` su un percorso **senza il separatore finale** confronta
 * **stringhe**, non directory. Con `wwwPath = /home/u/ital8cms/www`, il percorso
 * `/home/u/ital8cms/wwwBackup/x.ejs` « inizia con » quella stringa pur essendo
 * una directory completamente diversa — e `path.normalize` non ha nulla da
 * risolvere, perché `path.join` ha già consumato il `..`. La guardia approvava.
 *
 * L'exploit era limitato — solo directory **sorelle** il cui nome inizia per
 * `www`, e serve già il ruolo admin — ma quello che conta è l'**idioma**: è la
 * forma classicamente sbagliata di questo controllo, scritta in una funzione
 * che si chiamava `isPathSafe`. Chi la legge la prende per un esempio.
 *
 * ─── LA FORMA GIUSTA ─────────────────────────────────────────────────────────
 * Si confronta con la radice **più il separatore**, e si ammette la radice
 * stessa come caso a parte. Questa versione esisteva già nel progetto, in
 * `plugins/adminMedia/lib/mediaManager.js`: viveva a due file di distanza da
 * quella sbagliata, ed è il motivo per cui ora sta qui — una copia giusta e una
 * sbagliata sono il modo in cui una correzione ne raggiunge una sola.
 *
 * ─── RESTITUISCE null, NON LA RADICE ─────────────────────────────────────────
 * Chi rileva un tentativo di uscita deve **rifiutare**, non dirottare. In
 * `mediaManager.resolveAbsPath` il risultato era `safeResolve(...) || mediaRoot`:
 * un upload verso `../../etc` finiva nella cartella media invece di ricevere un
 * errore. Non è una vulnerabilità, è un fallimento **silenzioso** in un punto in
 * cui il rifiuto esplicito è l'unica risposta leggibile.
 *
 * @module core/resolveInsideRoot
 */

'use strict';

const path = require('path');

/**
 * @param {string} root    - Directory radice (assoluta)
 * @param {string} relPath - Percorso relativo, come arriva da fuori
 * @returns {string|null} Percorso assoluto dentro la radice, o null se ne esce
 */
function resolveInsideRoot(root, relPath) {
  if (!root || typeof root !== 'string') return null;

  const rootAbs = path.resolve(root);

  // NON si toglie nulla dal percorso: si risolve e si guarda dove si è finiti.
  //
  // La versione di `mediaManager` toglieva i `..` iniziali prima di risolvere,
  // quindi `../wwwBackup/x` diventava `wwwBackup/x` — dentro la radice. È
  // sicuro, ma è una RISCRITTURA silenziosa: chi chiedeva un percorso fuori
  // riceveva un percorso dentro, diverso da quello chiesto, senza saperlo. Qui
  // un tentativo di uscita è un rifiuto, e chi chiama decide cosa farne.
  const resolved = path.resolve(rootAbs, String(relPath || ''));

  // Il separatore è il punto: senza, `wwwBackup` « inizia con » `www`.
  const rootWithSep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
  if (resolved !== rootAbs && !resolved.startsWith(rootWithSep)) return null;

  return resolved;
}

/**
 * Variante booleana, per chi deve solo sapere se il percorso è dentro.
 *
 * @param {string} root
 * @param {string} relPath
 * @returns {boolean}
 */
function isInsideRoot(root, relPath) {
  return resolveInsideRoot(root, relPath) !== null;
}

module.exports = { resolveInsideRoot, isInsideRoot };
