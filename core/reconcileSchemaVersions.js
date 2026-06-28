/**
 * reconcileSchemaVersions — applica reconcileSchemaVersion (drift check + merge
 * additivo) a un insieme di config al boot, e riepiloga in un box `[SCHEMA]`.
 *
 * Lavora su:
 *   - `containers`: cartelle contenitore (es. `plugins/`, `themes/`) di cui
 *     scandisce le sottocartelle dirette cercando le coppie `*.default.json5` /
 *     `*.json5` con vivo esistente;
 *   - `pairs`: coppie esplicite (i config core: ital8Config/adminConfig/koaSession).
 *
 * Box anti-rumore: segnala solo i drift **significativi** — i `merged` con chiavi
 * effettivamente aggiunte e i casi `live-ahead` (anomali). Il semplice allineamento
 * di `schemaVersion` su un vivo pre-versionamento (merge senza chiavi nuove) avviene
 * ma resta silenzioso. Vedi config-lifecycle §6 (rilevamento drift, soluzione-ponte).
 *
 * API:
 *   reconcileSchemaVersions({ containers?: string[], pairs?: {label,defaultPath,livePath}[] })
 *     → Promise<{ drifted, alignedSilently, ahead, errors }>
 *
 * Non lancia per i singoli errori (li raccoglie in `errors`): il boot non si ferma.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const reconcileSchemaVersion = require('./reconcileSchemaVersion');

const DEFAULT_SUFFIX = '.default.json5';

// Scansiona i figli diretti di un contenitore → coppie default/vivo.
function scanContainer(containerDir) {
  const pairs = [];
  let entries;
  try {
    entries = fs.readdirSync(containerDir, { withFileTypes: true });
  } catch (_) {
    return pairs;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sub = path.join(containerDir, entry.name);
    let files;
    try { files = fs.readdirSync(sub); } catch (_) { continue; }
    for (const f of files) {
      if (!f.endsWith(DEFAULT_SUFFIX)) continue;
      const liveName = f.slice(0, -DEFAULT_SUFFIX.length) + '.json5';
      pairs.push({
        label: `${entry.name}/${liveName}`,
        defaultPath: path.join(sub, f),
        livePath: path.join(sub, liveName),
      });
    }
  }
  return pairs;
}

async function reconcileSchemaVersions({ containers = [], pairs = [] } = {}) {
  const all = [...pairs];
  for (const c of containers) all.push(...scanContainer(c));

  const drifted = [];          // merged con chiavi aggiunte (drift significativo)
  const alignedSilently = [];  // merged senza chiavi nuove (solo schemaVersion bump)
  const ahead = [];            // vivo più avanti del default (anomalo)
  const errors = [];

  for (const { label, defaultPath, livePath } of all) {
    try {
      const res = await reconcileSchemaVersion(defaultPath, livePath);
      if (res.status === 'merged') {
        if (res.added && res.added.length > 0) drifted.push({ label, from: res.from, to: res.to, added: res.added });
        else alignedSilently.push({ label, from: res.from, to: res.to });
      } else if (res.status === 'live-ahead') {
        ahead.push({ label, from: res.from, to: res.to });
      }
    } catch (e) {
      errors.push({ label, message: e && e.message });
    }
  }

  if (drifted.length > 0 || ahead.length > 0) printSchemaDriftBox(drifted, ahead);

  return { drifted, alignedSilently, ahead, errors };
}

function printSchemaDriftBox(drifted, ahead) {
  const line = '[SCHEMA] ' + '═'.repeat(58);
  const out = ['', line, '[SCHEMA]  ⚠  Drift di struttura (schemaVersion) rilevato al boot', line];
  if (drifted.length > 0) {
    out.push(`[SCHEMA]  ${drifted.length} config aggiornati additivamente (chiavi nuove del default):`);
    for (const d of drifted) {
      out.push(`[SCHEMA]    • ${d.label}: v${d.from} → v${d.to}  (+ ${d.added.join(', ')})`);
    }
    out.push(
      '[SCHEMA]',
      '[SCHEMA]  Soluzione-ponte: aggiunte SOLO le chiavi nuove (valori esistenti',
      '[SCHEMA]  intatti). Per rinomine/rimozioni intervieni a mano — la migrazione',
      '[SCHEMA]  vera non è automatica. Verifica i valori dei nuovi campi.',
    );
  }
  if (ahead.length > 0) {
    out.push('[SCHEMA]', `[SCHEMA]  ${ahead.length} config con schemaVersion PIÙ AVANTI del default (anomalo):`);
    for (const a of ahead) out.push(`[SCHEMA]    • ${a.label}: vivo v${a.from} > default v${a.to}`);
  }
  out.push(line, '');
  console.warn(out.join('\n'));
}

module.exports = reconcileSchemaVersions;
