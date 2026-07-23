#!/usr/bin/env node
/**
 * npm run restore — ripristina l'installazione da uno snapshot di backups/.
 *
 * Flusso:
 *   1. Risolve il backup target (--latest oppure --name <nome> / posizionale).
 *   2. Preflight sul server in esecuzione (via unix socket):
 *        - sotto supervisor (systemd/pm2/...) → STOP + istruzioni manuali, esce.
 *        - self-managed → SIGTERM e attesa chiusura (a meno di --keep-running).
 *   3. Backup di sicurezza dello stato corrente (reason: pre-restore).
 *   4. Overlay dello snapshot su projectRoot.
 *   5. Istruzioni per riavviare (simmetria: lo script NON riavvia da sé) e per
 *      riallineare le dipendenze (npm install + deps-sync).
 *
 * Uso:
 *   npm run restore -- --latest
 *   npm run restore -- --name backup-23-07-2026_18-30-00
 *   npm run restore -- --latest --yes
 *   npm run restore -- --latest --dry-run
 *
 * Solo built-in di Node (nessuna dipendenza npm).
 */

'use strict';

const path = require('path');
const readline = require('readline');
const backupEngine = require('./lib/backupEngine');
const serverControl = require('./lib/serverControl');
const { parseArgs } = require('./lib/cliArgs');

const projectRoot = path.resolve(__dirname, '..');
const { _: positional, flags } = parseArgs(process.argv.slice(2), ['name']);

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(String(answer).trim()); });
  });
}
const confirm = (q) => ask(q).then((a) => /^y(es)?$/i.test(a) || /^s(i|ì)?$/i.test(a));

function resolveTarget() {
  const all = backupEngine.listBackups(projectRoot);
  if (all.length === 0) throw new Error('nessun backup presente (usa: npm run backup)');
  if (flags.latest) return all[0];
  const name = typeof flags.name === 'string' ? flags.name : positional[0];
  if (!name) throw new Error('specifica --latest oppure --name <nome> (vedi: npm run backup-list)');
  const found = all.find((b) => b.name === name);
  if (!found) throw new Error(`backup non trovato: ${name}`);
  return found;
}

async function main() {
  if (flags.help) {
    process.stdout.write('Uso: npm run restore -- (--latest | --name <nome>) [--yes] [--dry-run] [--keep-running]\n');
    process.exit(0);
  }

  let target;
  try { target = resolveTarget(); }
  catch (err) { process.stderr.write(`✗ ${err.message}\n`); process.exit(1); }

  const m = target.manifest || {};
  process.stdout.write(`Ripristino da: ${target.name}\n`);
  process.stdout.write(`  versione: ${m.cmsVersion || '?'}  git: ${(m.gitSha || '?').slice(0, 12)}  creato: ${m.createdAt || '?'}\n`);
  process.stdout.write(`  node_modules nello snapshot: ${m.includesNodeModules ? 'sì' : 'no'}\n`);

  if (flags['dry-run']) {
    const treeDir = path.join(target.dir, backupEngine.TREE_SUBDIR);
    process.stdout.write(`\n[dry-run] verrebbero sovrascritte le entry top-level dello snapshot in ${projectRoot}:\n`);
    try {
      const fs = require('fs');
      for (const ent of fs.readdirSync(treeDir)) process.stdout.write(`  - ${ent}\n`);
    } catch (_) {}
    process.stdout.write('[dry-run] nessuna modifica effettuata.\n');
    process.exit(0);
  }

  // 2) Preflight server.
  const stop = await serverControl.stopSelfManaged(projectRoot).catch(() => null);
  if (stop && stop.supervised) {
    process.stderr.write(`\n⚠ Il server è avviato sotto supervisor (${stop.supervised}).\n`);
    process.stderr.write('  Ferma prima il servizio a mano, poi rilancia il restore:\n');
    process.stderr.write('    sudo systemctl stop <tuo-servizio-ital8cms>   # oppure: pm2 stop <app>\n');
    process.exit(1);
  }
  if (stop && stop.wasRunning && !stop.stopped && !flags['keep-running']) {
    process.stderr.write('\n⚠ Il server risulta in esecuzione ma non si è fermato entro il timeout.\n');
    process.stderr.write('  Fermalo a mano e riprova (oppure usa --keep-running a tuo rischio).\n');
    process.exit(1);
  }
  if (stop && stop.stopped) process.stdout.write('ℹ server fermato (SIGTERM).\n');

  // Conferma (il restore sovrascrive lo stato corrente).
  if (!flags.yes) {
    const ok = await confirm('\nProcedere col ripristino? Sovrascrive i file correnti. [y/N] ');
    if (!ok) { process.stdout.write('Ripristino annullato.\n'); process.exit(0); }
  }

  // 3) Backup di sicurezza dello stato corrente.
  try {
    const safety = backupEngine.createBackup(projectRoot, { reason: 'pre-restore', label: 'pre-restore' });
    process.stdout.write(`ℹ stato corrente salvato in ${path.relative(projectRoot, safety.dir)} (per annullare)\n`);
  } catch (err) {
    process.stderr.write(`⚠ impossibile creare il backup di sicurezza: ${err.message}\n`);
    if (!flags.yes && !(await confirm('Procedere comunque senza rete di sicurezza? [y/N] '))) {
      process.stdout.write('Ripristino annullato.\n'); process.exit(0);
    }
  }

  // 4) Overlay.
  try {
    const res = backupEngine.restoreBackup(projectRoot, target.name);
    process.stdout.write(`✓ ripristinate ${res.restored.length} entry top-level da ${target.name}\n`);
  } catch (err) {
    process.stderr.write(`✗ ripristino fallito: ${err.message}\n`);
    process.exit(1);
  }

  // 5) Istruzioni (simmetria: non riavviamo noi).
  process.stdout.write('\nProssimi passi:\n');
  if (!m.includesNodeModules) {
    process.stdout.write('  1) npm install            (le dipendenze non erano nello snapshot)\n');
    process.stdout.write('  2) npm run deps-sync      (dipendenze dei plugin/temi self-contained)\n');
    process.stdout.write('  3) npm start\n');
  } else {
    process.stdout.write('  1) npm start\n');
  }
  process.exit(0);
}

main().catch((err) => { process.stderr.write(`✗ ${err.message}\n`); process.exit(1); });
