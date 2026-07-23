/**
 * cliArgs — parser minimale di argomenti da riga di comando (solo built-in).
 * Usato dagli script di manutenzione (backup/restore/...) che evitano dipendenze
 * npm per restare eseguibili anche con node_modules assente/danneggiato.
 *
 * Supporta:
 *   --flag            → flags.flag = true
 *   --no-flag         → flags.flag = false
 *   --key value       → flags.key = "value"
 *   --key=value       → flags.key = "value"
 *   posizionali       → _  (array)
 *
 * `valueKeys` elenca le opzioni che consumano il token successivo come valore
 * (es. ['label','name','keep']); le altre `--x` sono booleane.
 */

'use strict';

function parseArgs(argv, valueKeys = []) {
  const flags = {};
  const _ = [];
  const wantsValue = new Set(valueKeys);

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      const body = tok.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (body.startsWith('no-')) {
        flags[body.slice(3)] = false;
      } else if (wantsValue.has(body) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        flags[body] = argv[++i];
      } else {
        flags[body] = true;
      }
    } else {
      _.push(tok);
    }
  }
  return { _, flags };
}

module.exports = { parseArgs };
