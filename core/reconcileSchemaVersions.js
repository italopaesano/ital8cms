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
 * Box anti-rumore, con una distinzione che vale la pena capire. Un merge che non
 * ha aggiunto NULLA (`added: []`) significa due cose molto diverse a seconda di
 * dove partiva il vivo:
 *
 *   - `from === 0` → il vivo è **pre-versionamento** (non aveva `schemaVersion`):
 *     l'allineamento è di pura forma, non c'era drift. Resta **silenzioso**: è
 *     esattamente il rumore che il box deve evitare.
 *
 *   - `from >= 1` → il vivo era **già versionato** e il default è andato avanti,
 *     ma il merge non ha trovato una sola chiave da aggiungere. Vuol dire che il
 *     bump ha cambiato qualcosa che il merge non sa vedere — un valore, una
 *     rinomina, una rimozione. È il caso `unresolved`, e va **segnalato**.
 *
 * Prima erano indistinguibili e tacevano entrambi: così i tre bump del progetto
 * che non hanno prodotto l'effetto atteso sono passati inosservati, lasciando
 * ogni volta un vivo la cui `schemaVersion` dichiarava di essere aggiornato
 * mentre non lo era. Vedi docs/decisions/config-migrations.it.md.
 *
 * PRECEDENZA DELLE MIGRAZIONI. Dove un pacchetto dichiara una migrazione per il
 * salto in corso (`migrations/`), il merge additivo NON deve intervenire: sarebbe
 * il primo ad allineare `schemaVersion`, e allineandola **brucerebbe il trigger**
 * della migrazione — al boot successivo il vivo risulterebbe aggiornato e la
 * rinomina/rimozione dichiarata non verrebbe più applicata, per sempre. I file
 * interessati arrivano in `skipLivePaths` e vengono saltati in blocco.
 *
 * API:
 *   reconcileSchemaVersions({ containers?, pairs?, skipLivePaths? })
 *     skipLivePaths: Set<string>|string[] — path dei vivi da NON riconciliare
 *     → Promise<{ drifted, unresolved, alignedSilently, ahead, skipped, errors }>
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

async function reconcileSchemaVersions({ containers = [], pairs = [], skipLivePaths = [] } = {}) {
  const all = [...pairs];
  for (const c of containers) all.push(...scanContainer(c));

  // Normalizzati a path assoluti: chiamante e scanner possono costruirli in modi
  // diversi (relativi vs assoluti) e un confronto per stringa fallirebbe in
  // silenzio, lasciando passare proprio i file da proteggere.
  const skip = new Set(
    (skipLivePaths instanceof Set ? [...skipLivePaths] : skipLivePaths).map((p) => path.resolve(p))
  );

  const drifted = [];          // merged con chiavi aggiunte (drift significativo)
  const unresolved = [];       // merged senza chiavi nuove su un vivo GIÀ versionato
  const alignedSilently = [];  // merged senza chiavi nuove su un vivo pre-versionamento
  const ahead = [];            // vivo più avanti del default (anomalo)
  const skipped = [];          // saltati: una migrazione dichiarata li gestirà
  const errors = [];

  for (const { label, defaultPath, livePath } of all) {
    if (skip.has(path.resolve(livePath))) { skipped.push({ label }); continue; }
    try {
      const res = await reconcileSchemaVersion(defaultPath, livePath);
      if (res.status === 'merged') {
        if (res.added && res.added.length > 0) drifted.push({ label, from: res.from, to: res.to, added: res.added });
        else if (res.from >= 1) unresolved.push({ label, from: res.from, to: res.to });
        else alignedSilently.push({ label, from: res.from, to: res.to });
      } else if (res.status === 'live-ahead') {
        ahead.push({ label, from: res.from, to: res.to });
      }
    } catch (e) {
      errors.push({ label, message: e && e.message });
    }
  }

  if (drifted.length > 0 || unresolved.length > 0 || ahead.length > 0) {
    printSchemaDriftBox(drifted, unresolved, ahead);
  }

  return { drifted, unresolved, alignedSilently, ahead, skipped, errors };
}

function printSchemaDriftBox(drifted, unresolved, ahead) {
  const line = '[SCHEMA] ' + '═'.repeat(58);
  const out = ['', line, '[SCHEMA]  ⚠  Drift di struttura (schemaVersion) rilevato al boot', line];
  if (drifted.length > 0) {
    out.push(`[SCHEMA]  ${drifted.length} config aggiornati additivamente (chiavi nuove del default):`);
    for (const d of drifted) {
      out.push(`[SCHEMA]    • ${d.label}: v${d.from} → v${d.to}  (+ ${d.added.join(', ')})`);
    }
    out.push(
      '[SCHEMA]',
      '[SCHEMA]  Aggiunte SOLO le chiavi nuove, a ogni profondità (valori esistenti',
      '[SCHEMA]  intatti). Per rinomine/rimozioni serve una migrazione dedicata',
      '[SCHEMA]  (migrations/). Verifica i valori dei nuovi campi.',
    );
  }
  if (unresolved.length > 0) {
    out.push('[SCHEMA]', `[SCHEMA]  ${unresolved.length} config con drift NON risolto dal merge:`);
    for (const u of unresolved) {
      out.push(`[SCHEMA]    • ${u.label}: v${u.from} → v${u.to}  (nessuna chiave da aggiungere)`);
    }
    out.push(
      '[SCHEMA]',
      '[SCHEMA]  Il .default ha alzato schemaVersion ma la struttura del vivo era',
      '[SCHEMA]  già completa: il bump riguarda un VALORE cambiato, una rinomina o',
      '[SCHEMA]  una rimozione — cose che il merge additivo non può applicare.',
      '[SCHEMA]  Confronta il vivo col suo .default e allinea a mano, oppure fornisci',
      '[SCHEMA]  una migrazione in migrations/ (docs/decisions/config-migrations.it.md).',
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
