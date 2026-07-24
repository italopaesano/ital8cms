#!/usr/bin/env node
/**
 * npm run deps-sync — riconcilia le dipendenze npm di plugin e temi.
 *
 * Rami (vedi scripts/lib/pluginDepsReconciler.js):
 *   - self-contained (ha package.json)   → npm install dentro la cartella
 *   - legacy (nodeModuleDependency)       → npm install --no-save a root
 *   + riallinea nodeModuleDependency del config vivo dal .default
 *
 * Uso:
 *   npm run deps-sync
 *   npm run deps-sync -- --dry-run
 *   npm run deps-sync -- --clean         (npm ci nei rami self-contained)
 *   npm run deps-sync -- --json
 *
 * Modalità --postinstall (hook di root package.json): best-effort, esce SEMPRE 0
 * per non far mai fallire `npm install`. Le deps non risolte restano un warning
 * (il plugin sarà 'incomplete' al boot, comportamento graceful già previsto).
 */

'use strict';

const path = require('path');
const { parseArgs } = require('./lib/cliArgs');

const projectRoot = process.env.ITAL8CMS_PROJECT_ROOT
  ? path.resolve(process.env.ITAL8CMS_PROJECT_ROOT)
  : path.resolve(__dirname, '..');
const { flags } = parseArgs(process.argv.slice(2), []);
const postinstall = flags.postinstall === true;
const quiet = postinstall || flags.quiet === true || flags.json === true;

async function main() {
  if (flags.help) {
    process.stdout.write('Uso: npm run deps-sync -- [--dry-run] [--clean] [--json]\n');
    process.exit(0);
  }

  // Il reconciler usa i moduli core (json5): richiede node_modules di root.
  let reconcile;
  try {
    ({ reconcile } = require('./lib/pluginDepsReconciler'));
  } catch (err) {
    const msg = `deps-sync: moduli core non caricabili (${err.message}). Esegui prima "npm install".`;
    if (postinstall) { process.stderr.write(`⚠ ${msg}\n`); process.exit(0); }
    process.stderr.write(`✗ ${msg}\n`);
    process.exit(1);
  }

  const report = await reconcile(projectRoot, {
    clean: flags.clean === true,
    dryRun: flags['dry-run'] === true,
    onLog: quiet ? undefined : (m) => process.stdout.write(`  ${m}\n`),
  });

  if (flags.json) {
    process.stdout.write(JSON.stringify({ ok: report.warnings.length === 0, report }) + '\n');
    process.exit(0);
  }

  const touched = report.perPlugin.length + report.legacy.length + report.realigned.length;
  if (!quiet) {
    if (touched === 0) process.stdout.write('✓ deps-sync: nulla da fare (dipendenze già allineate)\n');
    else process.stdout.write(`✓ deps-sync: ${report.perPlugin.length} self-contained, ${report.legacy.length} legacy, ${report.realigned.length} realign\n`);
  }
  if (report.warnings.length) {
    process.stdout.write(`⚠ ${report.warnings.length} avvisi:\n`);
    for (const w of report.warnings) process.stdout.write(`   - ${w}\n`);
  }

  // postinstall: mai far fallire l'install padre. Altrove: 0 anche con warning
  // (i warning sono non-fatali per design), 1 solo su crash (già gestito sopra).
  process.exit(0);
}

main().catch((err) => {
  if (postinstall) { process.stderr.write(`⚠ deps-sync (postinstall): ${err.message}\n`); process.exit(0); }
  process.stderr.write(`✗ deps-sync: ${err.message}\n`);
  process.exit(1);
});
