#!/usr/bin/env node
/**
 * npm run backup-manager — gestione dei backup: elenca, elimina, pruna.
 *
 * Modalità diretta (non interattiva):
 *   npm run backup-manager -- delete <nome>
 *   npm run backup-manager -- prune <n>          (tieni gli ultimi n, elimina il resto)
 *   npm run backup-manager -- list
 *
 * Modalità interattiva (nessun argomento): menu con readline.
 *
 * Solo built-in di Node (nessuna dipendenza npm): resta usabile anche con
 * node_modules assente/danneggiato.
 */

'use strict';

const path = require('path');
const readline = require('readline');
const backupEngine = require('./lib/backupEngine');
const { parseArgs } = require('./lib/cliArgs');

const projectRoot = process.env.ITAL8CMS_PROJECT_ROOT
  ? path.resolve(process.env.ITAL8CMS_PROJECT_ROOT)
  : path.resolve(__dirname, '..');
const { _: positional, flags } = parseArgs(process.argv.slice(2), []);

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(String(answer).trim()); });
  });
}

function confirm(question) {
  return ask(question).then((a) => /^y(es)?$/i.test(a) || /^s(i|ì)?$/i.test(a));
}

function printList(backups) {
  if (backups.length === 0) { process.stdout.write('Nessun backup presente.\n'); return; }
  backups.forEach((b, i) => {
    const m = b.manifest || {};
    process.stdout.write(`  [${i + 1}] ${b.name}  (v${m.cmsVersion || '?'}, ${m.reason || '?'}, ${backupEngine.humanSize(b.sizeBytes)})\n`);
  });
}

async function runInteractive() {
  for (;;) {
    const backups = backupEngine.listBackups(projectRoot);
    process.stdout.write('\n=== Backup manager ===\n');
    printList(backups);
    process.stdout.write('\nComandi: [numero] elimina  ·  p <n> prune  ·  q esci\n');
    const cmd = await ask('> ');

    if (cmd === 'q' || cmd === '') return;

    if (cmd.startsWith('p ')) {
      const keep = parseInt(cmd.slice(2).trim(), 10);
      if (!Number.isInteger(keep) || keep < 0) { process.stdout.write('⚠ numero non valido\n'); continue; }
      if (await confirm(`Tenere gli ultimi ${keep} ed eliminare il resto? [y/N] `)) {
        const res = backupEngine.pruneBackups(projectRoot, keep);
        process.stdout.write(`✓ prune: rimossi ${res.removed.length}, tenuti ${res.kept.length}\n`);
      }
      continue;
    }

    const idx = parseInt(cmd, 10);
    if (Number.isInteger(idx) && idx >= 1 && idx <= backups.length) {
      const target = backups[idx - 1];
      if (await confirm(`Eliminare "${target.name}"? [y/N] `)) {
        backupEngine.deleteBackup(projectRoot, target.name);
        process.stdout.write(`✓ eliminato: ${target.name}\n`);
      }
      continue;
    }
    process.stdout.write('⚠ comando non riconosciuto\n');
  }
}

async function main() {
  const sub = positional[0];

  if (!sub) { await runInteractive(); process.exit(0); }

  if (sub === 'list') {
    printList(backupEngine.listBackups(projectRoot));
    process.exit(0);
  }

  if (sub === 'delete') {
    const name = positional[1];
    if (!name) { process.stderr.write('✗ uso: backup-manager delete <nome>\n'); process.exit(1); }
    if (!flags.yes && !(await confirm(`Eliminare "${name}"? [y/N] `))) { process.stdout.write('annullato.\n'); process.exit(0); }
    backupEngine.deleteBackup(projectRoot, name);
    process.stdout.write(`✓ eliminato: ${name}\n`);
    process.exit(0);
  }

  if (sub === 'prune') {
    const keep = parseInt(positional[1], 10);
    if (!Number.isInteger(keep) || keep < 0) { process.stderr.write('✗ uso: backup-manager prune <n>\n'); process.exit(1); }
    if (!flags.yes && !(await confirm(`Tenere gli ultimi ${keep} ed eliminare il resto? [y/N] `))) { process.stdout.write('annullato.\n'); process.exit(0); }
    const res = backupEngine.pruneBackups(projectRoot, keep);
    process.stdout.write(`✓ prune: rimossi ${res.removed.length}, tenuti ${res.kept.length}\n`);
    process.exit(0);
  }

  process.stderr.write(`✗ sottocomando sconosciuto: ${sub} (list|delete|prune)\n`);
  process.exit(1);
}

main().catch((err) => { process.stderr.write(`✗ ${err.message}\n`); process.exit(1); });
