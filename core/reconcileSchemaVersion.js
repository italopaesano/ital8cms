/**
 * reconcileSchemaVersion — rileva il "drift" di STRUTTURA tra un config vivo e il
 * suo `.default` confrontando il campo `schemaVersion`, e applica un **merge
 * additivo** come soluzione-ponte (config-lifecycle §6).
 *
 * Contesto: `schemaVersion` (intero, prima chiave) versiona la *struttura* del
 * file, non i valori. L'incremento è delegato allo sviluppatore quando cambia la
 * struttura del `.default`. Al boot, se il `.default` ha una `schemaVersion` più
 * recente del vivo (struttura evoluta), questa utility:
 *   1. aggiunge al vivo le chiavi **nuove** presenti nel default, a QUALSIASI
 *      profondità (senza toccare i valori già esistenti — niente override delle
 *      scelte utente);
 *   2. allinea `schemaVersion` del vivo a quella del default.
 *
 * MERGE RICORSIVO: la prima versione aggiungeva le sole chiavi **top-level**, e
 * sul campo non bastava — quasi tutte le impostazioni di un plugin vivono sotto
 * `custom`, che nel vivo esiste già, quindi ogni nuovo default annidato veniva
 * saltato. Dei quattro bump realmente avvenuti nel progetto, tre non hanno
 * prodotto l'effetto atteso (due chiavi annidate e un cambio di valore) e hanno
 * generato altrettanti workaround nel codice. Ora la traversata scende nei
 * sotto-oggetti; quando manca un intero sottoalbero viene inserito in blocco,
 * senza discendervi. Vedi docs/decisions/config-migrations.it.md.
 *
 * Resta PARZIALE per costruzione: gestisce le *aggiunte*, non rinominazioni,
 * rimozioni o cambi di valore — quelli sono competenza delle migrazioni
 * (`migrations/`). Per questo il chiamante segnala comunque il drift.
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
 *                            `added` contiene path in notazione puntata (`custom.dataPath`)
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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Raccoglie i path presenti nel default e assenti nel vivo, scendendo nei
 * sotto-oggetti. Si ferma al primo livello mancante: se manca un intero
 * sottoalbero viene riportato quello, non le sue foglie (verrà inserito in
 * blocco, con la sua struttura).
 *
 * Gli array sono trattati come valori, non come contenitori navigabili: un array
 * già presente nel vivo è una scelta dell'utente e non va fuso elemento per
 * elemento (coerente con editJson5, che non naviga negli indici).
 *
 * @param {object} defaultObj
 * @param {object} liveObj
 * @param {string[]} [prefix] - Path accumulato nella ricorsione.
 * @returns {Array<{segments: string[], value: *}>}
 */
function collectMissingPaths(defaultObj, liveObj, prefix = []) {
  const missing = [];
  for (const key of Object.keys(defaultObj)) {
    if (prefix.length === 0 && key === 'schemaVersion') continue;
    const segments = [...prefix, key];
    const defaultValue = defaultObj[key];
    if (!Object.prototype.hasOwnProperty.call(liveObj, key)) {
      missing.push({ segments, value: defaultValue });
      continue;
    }
    // Presente in entrambi: si scende solo se entrambi sono oggetti semplici.
    if (isPlainObject(defaultValue) && isPlainObject(liveObj[key])) {
      missing.push(...collectMissingPaths(defaultValue, liveObj[key], segments));
    }
  }
  return missing;
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

  // liveV < defV → drift: merge additivo RICORSIVO delle chiavi nuove del default.
  await setJson5Key(livePath, 'schemaVersion', defV); // allinea (aggiunge se mancava)

  const added = [];
  for (const { segments, value } of collectMissingPaths(def, live)) {
    // `afterKey` vale solo al top-level: in profondità l'inserimento va in testa
    // al blocco del parent, dove non esiste un'ancora sensata da rispettare.
    const options = segments.length === 1 ? { afterKey: 'schemaVersion' } : {};
    await setJson5Key(livePath, segments, value, options);
    added.push(segments.join('.'));
  }

  return { status: 'merged', from: liveV, to: defV, added };
}

module.exports = reconcileSchemaVersion;
