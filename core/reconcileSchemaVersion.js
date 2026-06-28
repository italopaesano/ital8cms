/**
 * reconcileSchemaVersion — rileva il "drift" di STRUTTURA tra un config vivo e il
 * suo `.default` confrontando il campo `schemaVersion`, e applica un **merge
 * additivo** come soluzione-ponte (config-lifecycle §6).
 *
 * Contesto: `schemaVersion` (intero, prima chiave) versiona la *struttura* del
 * file, non i valori. L'incremento è delegato allo sviluppatore quando cambia la
 * struttura del `.default`. Al boot, se il `.default` ha una `schemaVersion` più
 * recente del vivo (struttura evoluta), questa utility:
 *   1. aggiunge al vivo le sole chiavi top-level **nuove** presenti nel default
 *      (senza toccare i valori già esistenti — niente override delle scelte utente);
 *   2. allinea `schemaVersion` del vivo a quella del default.
 *
 * È volutamente PARZIALE: gestisce solo le *aggiunte* di chiavi. Rinominazioni e
 * rimozioni richiedono la migrazione vera (rimandata). Per questo il chiamante
 * emette comunque un warning di drift, così lo sviluppatore può rivedere.
 * Nota: i commenti associati alle chiavi nuove nel `.default` NON vengono copiati
 * (setJson5Key inserisce solo `chiave: valore`).
 *
 * API:
 *   reconcileSchemaVersion(defaultPath, livePath) → Promise<{ status, ... }>
 *     status:
 *       'no-live'            il vivo non esiste (lo gestisce la materializzazione)
 *       'no-default-version' il default non ha `schemaVersion` (non versionabile)
 *       'aligned'            stesse versioni: nessuna azione
 *       'live-ahead'         il vivo è PIÙ avanti del default (anomalo) → { from, to }
 *       'merged'             drift risolto additivamente → { from, to, added: string[] }
 *
 * Throws su: argomenti non validi; default mancante / JSON5 non valido; vivo JSON5 non valido.
 */

'use strict';

const fs = require('fs').promises;
const loadJson5 = require('./loadJson5');
const setJson5Key = require('./setJson5Key');

function asIntVersion(value, fallback) {
  return Number.isInteger(value) ? value : fallback;
}

/**
 * Riconcilia lo schemaVersion di un vivo rispetto al suo default (merge additivo).
 *
 * @param {string} defaultPath - Path del `x.default.json5`.
 * @param {string} livePath - Path del `x.json5` vivo.
 * @returns {Promise<{status: string, from?: number, to?: number, added?: string[]}>}
 */
async function reconcileSchemaVersion(defaultPath, livePath) {
  if (typeof defaultPath !== 'string' || defaultPath.length === 0) {
    throw new Error('reconcileSchemaVersion: defaultPath must be a non-empty string');
  }
  if (typeof livePath !== 'string' || livePath.length === 0) {
    throw new Error('reconcileSchemaVersion: livePath must be a non-empty string');
  }

  let liveExists = false;
  try { await fs.access(livePath); liveExists = true; } catch (_) { liveExists = false; }
  if (!liveExists) return { status: 'no-live' };

  const def = loadJson5(defaultPath);   // throw se manca/invalido
  const live = loadJson5(livePath);     // throw se invalido

  const defV = asIntVersion(def.schemaVersion, null);
  if (defV === null) return { status: 'no-default-version' };
  const liveV = asIntVersion(live.schemaVersion, 0); // assente nel vivo → 0 (pre-versionamento)

  if (liveV === defV) return { status: 'aligned' };
  if (liveV > defV) return { status: 'live-ahead', from: liveV, to: defV };

  // liveV < defV → drift: merge additivo delle chiavi top-level nuove del default.
  await setJson5Key(livePath, 'schemaVersion', defV); // allinea (aggiunge se mancava)

  const added = [];
  for (const key of Object.keys(def)) {
    if (key === 'schemaVersion') continue;
    if (!Object.prototype.hasOwnProperty.call(live, key)) {
      await setJson5Key(livePath, key, def[key], { afterKey: 'schemaVersion' });
      added.push(key);
    }
  }

  return { status: 'merged', from: liveV, to: defV, added };
}

module.exports = reconcileSchemaVersion;
