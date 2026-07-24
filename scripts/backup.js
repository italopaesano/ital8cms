#!/usr/bin/env node
/**
 * npm run backup — crea uno snapshot dell'installazione ital8cms in backups/.
 *
 * Sola lettura sul progetto (non ferma il server): può girare a caldo, con un
 * piccolo rischio di inconsistenza se dei file cambiano durante la copia.
 *
 * Uso:
 *   npm run backup
 *   npm run backup -- --label pre-esperimento
 *   npm run backup -- --with-node-modules      (snapshot autonomo, più pesante)
 *   npm run backup -- --no-git                 (escludi .git)
 *   npm run backup -- --keep 5                 (pruna i vecchi, tieni gli ultimi 5)
 *   npm run backup -- --json
 */

'use strict';

const path = require('path');
const backupEngine = require('./lib/backupEngine');
const { parseArgs } = require('./lib/cliArgs');

const projectRoot = process.env.ITAL8CMS_PROJECT_ROOT
  ? path.resolve(process.env.ITAL8CMS_PROJECT_ROOT)
  : path.resolve(__dirname, '..');
const { flags } = parseArgs(process.argv.slice(2), ['label', 'keep']);

if (flags.help) {
  process.stdout.write('Uso: npm run backup -- [--label <s>] [--with-node-modules] [--no-git] [--keep <n>] [--json]\n');
  process.exit(0);
}

try {
  const result = backupEngine.createBackup(projectRoot, {
    withNodeModules: flags['with-node-modules'] === true,
    includeGit: flags.git !== false,
    label: typeof flags.label === 'string' ? flags.label : null,
    reason: 'manual',
  });

  let pruned = null;
  if (flags.keep !== undefined) {
    const keep = parseInt(flags.keep, 10);
    if (Number.isInteger(keep) && keep >= 0) {
      pruned = backupEngine.pruneBackups(projectRoot, keep);
    }
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify({ ok: true, backup: result.manifest, pruned }) + '\n');
  } else {
    const rel = path.relative(projectRoot, result.dir);
    process.stdout.write(`✓ backup creato: ${rel}\n`);
    process.stdout.write(`  versione: ${result.manifest.cmsVersion || '?'}  node: ${result.manifest.nodeVersion}  git: ${(result.manifest.gitSha || '?').slice(0, 12)}\n`);
    process.stdout.write(`  node_modules: ${result.manifest.includesNodeModules ? 'inclusi' : 'esclusi'}  .git: ${result.manifest.includesGit ? 'incluso' : 'escluso'}\n`);
    process.stdout.write(`  dimensione: ${backupEngine.humanSize(backupEngine.findBackup(projectRoot, result.name).sizeBytes)}\n`);
    if (pruned && pruned.removed.length) {
      process.stdout.write(`  prune: rimossi ${pruned.removed.length} backup più vecchi (tenuti ${pruned.kept.length})\n`);
    }
  }
  process.exit(0);
} catch (err) {
  if (flags.json) process.stdout.write(JSON.stringify({ ok: false, error: err.message }) + '\n');
  else process.stderr.write(`✗ backup fallito: ${err.message}\n`);
  process.exit(1);
}
