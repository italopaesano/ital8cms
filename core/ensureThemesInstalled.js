/**
 * ensureThemesInstalled — completa i config vivi dei temi BUNDLED con il loro
 * stato di installazione di default (`isInstalled: 1`).
 *
 * Contesto (config-lifecycle, Fase 5): un tema "bundled" è quello distribuito con
 * ital8cms, riconoscibile perché ha un `themeConfig.default.json5` accanto al vivo;
 * è **installato per definizione**. Il `.default`, però, NON contiene `isInstalled`
 * (è uno stato runtime, esattamente come per i descrittori dei plugin — vedi
 * config-lifecycle §2); così un vivo appena materializzato dal `.default` in un
 * clone fresco ne è privo. Questo step di boot riempie il gap: per ogni tema
 * bundled il cui vivo **manca** di `isInstalled`, persiste `isInstalled: 1` via
 * `setJson5Key` (preservando i commenti), dopo `schemaVersion` come per i plugin.
 *
 * È volutamente NON distruttivo: imposta solo se `isInstalled` è ASSENTE (mai
 * sovrascrive un valore già presente). I temi non-bundled (installati via
 * `plugins/admin/themesInstall.js`, che NON portano un `.default`) non vengono
 * toccati, così il loro `isInstalled: 0` — l'attivazione resta scelta manuale
 * dell'admin — è preservato.
 *
 * Parallelo ai plugin: lì `pluginSys.initialize()` persiste `isInstalled` al boot
 * (Variante 1); i temi non hanno un `initialize()` che itera tutti i temi, quindi
 * questo step dedicato fa lo stesso lavoro per la cartella `themes/`.
 *
 * API:
 *   ensureThemesInstalled(themesDir) → Promise<{ updated, skipped, errors }>
 *     updated: [{ theme }]            vivo a cui è stato aggiunto isInstalled: 1
 *     skipped: [{ theme, reason }]    'no-default' | 'no-live' | 'already-present'
 *     errors:  [{ theme, message }]
 *
 * Non lancia per i singoli temi (li raccoglie in `errors`): il boot non si ferma.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const loadJson5 = require('./loadJson5');
const setJson5Key = require('./setJson5Key');

const DEFAULT_NAME = 'themeConfig.default.json5';
const LIVE_NAME = 'themeConfig.json5';

/**
 * Garantisce `isInstalled: 1` sui config vivi dei temi bundled che ne sono privi.
 *
 * @param {string} themesDir - Path della cartella `themes/`.
 * @returns {Promise<{updated: object[], skipped: object[], errors: object[]}>}
 */
async function ensureThemesInstalled(themesDir) {
  if (typeof themesDir !== 'string' || themesDir.length === 0) {
    throw new Error('ensureThemesInstalled: themesDir must be a non-empty string');
  }

  const updated = [];
  const skipped = [];
  const errors = [];

  let entries;
  try {
    entries = fs.readdirSync(themesDir, { withFileTypes: true });
  } catch (_) {
    return { updated, skipped, errors };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const theme = entry.name;
    const dir = path.join(themesDir, theme);
    const defaultPath = path.join(dir, DEFAULT_NAME);
    const livePath = path.join(dir, LIVE_NAME);

    // Solo temi bundled (con `.default`).
    if (!fs.existsSync(defaultPath)) { skipped.push({ theme, reason: 'no-default' }); continue; }
    if (!fs.existsSync(livePath)) { skipped.push({ theme, reason: 'no-live' }); continue; }

    try {
      const live = loadJson5(livePath);
      if (Object.prototype.hasOwnProperty.call(live, 'isInstalled')) {
        skipped.push({ theme, reason: 'already-present' });
        continue;
      }
      await setJson5Key(livePath, 'isInstalled', 1, { afterKey: 'schemaVersion' });
      updated.push({ theme });
    } catch (e) {
      errors.push({ theme, message: e && e.message });
    }
  }

  return { updated, skipped, errors };
}

module.exports = ensureThemesInstalled;
