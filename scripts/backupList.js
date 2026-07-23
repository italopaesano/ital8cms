#!/usr/bin/env node
/**
 * npm run backup-list — elenca gli snapshot presenti in backups/ (sola lettura).
 *
 * Uso:
 *   npm run backup-list
 *   npm run backup-list -- --json
 */

'use strict';

const path = require('path');
const backupEngine = require('./lib/backupEngine');
const { parseArgs } = require('./lib/cliArgs');

const projectRoot = path.resolve(__dirname, '..');
const { flags } = parseArgs(process.argv.slice(2), []);

const backups = backupEngine.listBackups(projectRoot);

if (flags.json) {
  process.stdout.write(JSON.stringify({
    ok: true,
    backups: backups.map((b) => ({ name: b.name, sizeBytes: b.sizeBytes, manifest: b.manifest })),
  }) + '\n');
  process.exit(0);
}

if (backups.length === 0) {
  process.stdout.write('Nessun backup presente (usa: npm run backup).\n');
  process.exit(0);
}

process.stdout.write(`${backups.length} backup (dal più recente):\n\n`);
for (const b of backups) {
  const m = b.manifest || {};
  process.stdout.write(`  ${b.name}\n`);
  process.stdout.write(`     versione: ${m.cmsVersion || '?'}  git: ${(m.gitSha || '?').slice(0, 12)}  node: ${m.nodeVersion || '?'}\n`);
  process.stdout.write(`     motivo: ${m.reason || '?'}  dim: ${backupEngine.humanSize(b.sizeBytes)}  node_modules: ${m.includesNodeModules ? 'sì' : 'no'}\n`);
}
process.stdout.write('\nRipristina con: npm run restore -- --name <nome>  (o --latest)\n');
process.exit(0);
