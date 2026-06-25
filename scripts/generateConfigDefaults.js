// This file follows the project ital8cms standard
//
// One-shot migration (Fase 0 — config-lifecycle): genera i *.default.json5 a
// partire dai config vivi attuali.
//   - Descrittori (pluginConfig/themeConfig): copia + schemaVersion, RIMUOVE
//     isInstalled (è stato runtime, non un default — vedi config-lifecycle §2).
//   - Altri config (core, contenuto, dati utente): copia + schemaVersion.
//
// NON tocca i file vivi. Verifica ogni output con loadJson5 (JSON5 valido,
// schemaVersion presente, isInstalled assente nei descrittori).
//
// Esclusi per policy: plugins/ccxt/ccxt.json5 e customExchangesKey.json5
// (ccxt = intervento dedicato; customExchangesKey può contenere segreti).
//
// Uso: node scripts/generateConfigDefaults.js [--force]
//   --force sovrascrive eventuali *.default.json5 già presenti.

const fs = require('fs');
const path = require('path');
const loadJson5 = require('../core/loadJson5');

const ROOT = path.join(__dirname, '..');
const FORCE = Array.isArray(process.argv) && process.argv.includes('--force');

const SCHEMA_COMMENT =
  'Versione della STRUTTURA del file (incrementare quando cambiano le chiavi). Vedi docs/decisions/config-lifecycle.it.md';

// ── Raccolta dei file ──────────────────────────────────────────────────────
function listGlob(dir, file) {
  const base = path.join(ROOT, dir);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base)
    .map((sub) => path.join(dir, sub, file))
    .filter((rel) => fs.existsSync(path.join(ROOT, rel)));
}

// Descrittori: copia + schemaVersion + rimozione isInstalled
const descriptors = [
  ...listGlob('plugins', 'pluginConfig.json5'),
  ...listGlob('themes', 'themeConfig.json5'),
];

// Config "plain": copia + schemaVersion
const plain = [
  'ital8Config.json5',
  'core/admin/adminConfig.json5',
  'core/priorityMiddlewares/koaSession.json5',
  'plugins/adminAccessControl/accessControl.json5',
  'plugins/seo/seoPages.json5',
  'plugins/urlRedirect/redirectMap.json5',
  'plugins/rateLimiter/protectedRoutes.json5',
  'plugins/admin/pluginInstallLog.json5',
  'plugins/adminUsers/userAccount.json5',
  'plugins/adminUsers/userRole.json5',
].filter((rel) => fs.existsSync(path.join(ROOT, rel)));

// ── Trasformazione testuale (preserva i commenti) ──────────────────────────
function transform(raw, { removeIsInstalled }) {
  const lines = raw.split('\n');
  const braceIdx = lines.findIndex((l) => l.trim() === '{');
  if (braceIdx === -1) {
    throw new Error("graffa di apertura '{' non trovata su riga propria");
  }
  const schemaLine = `  "schemaVersion": 1,  // ${SCHEMA_COMMENT}`;
  let out = [
    ...lines.slice(0, braceIdx + 1),
    schemaLine,
    ...lines.slice(braceIdx + 1),
  ];
  if (removeIsInstalled) {
    out = out.filter((l) => !/^\s*"isInstalled"\s*:/.test(l));
  }
  return out.join('\n');
}

function defaultPathFor(rel) {
  return rel.replace(/\.json5$/, '.default.json5');
}

// ── Esecuzione ─────────────────────────────────────────────────────────────
const generated = [];
const skipped = [];
const errors = [];

function process(rel, removeIsInstalled) {
  const livePath = path.join(ROOT, rel);
  const outRel = defaultPathFor(rel);
  const outPath = path.join(ROOT, outRel);

  if (fs.existsSync(outPath) && !FORCE) {
    skipped.push(outRel);
    return;
  }
  try {
    const raw = fs.readFileSync(livePath, 'utf8');
    const transformed = transform(raw, { removeIsInstalled });
    fs.writeFileSync(outPath, transformed, 'utf8');

    // Verifica
    const parsed = loadJson5(outPath);
    if (parsed.schemaVersion !== 1) {
      throw new Error('schemaVersion mancante o != 1 dopo la generazione');
    }
    if (removeIsInstalled && Object.prototype.hasOwnProperty.call(parsed, 'isInstalled')) {
      throw new Error('isInstalled ancora presente in un descrittore');
    }
    generated.push(outRel);
  } catch (err) {
    errors.push(`${outRel}: ${err.message}`);
  }
}

descriptors.forEach((rel) => process(rel, true));
plain.forEach((rel) => process(rel, false));

// ── Report ─────────────────────────────────────────────────────────────────
console.log('\n=== generateConfigDefaults — report ===');
console.log(`Descrittori (− isInstalled): ${descriptors.length}`);
console.log(`Config plain:                ${plain.length}`);
console.log(`Generati:                    ${generated.length}`);
console.log(`Saltati (già esistenti):     ${skipped.length}${FORCE ? '' : '  (usa --force per sovrascrivere)'}`);
console.log(`Errori:                      ${errors.length}`);
if (skipped.length) {
  console.log('\n-- saltati --');
  skipped.forEach((f) => console.log('  ' + f));
}
if (errors.length) {
  console.log('\n-- ERRORI --');
  errors.forEach((e) => console.log('  ✗ ' + e));
  process.exitCode = 1;
}
console.log('');
