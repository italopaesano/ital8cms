#!/usr/bin/env node
/**
 * npm run update — aggiorna ital8cms all'ultima release GitHub (strada B: git).
 *
 * Fasi:
 *   PREFLIGHT  git disponibile · è un repo git · nessun update in corso (lock) ·
 *              server sotto supervisor? → STOP + istruzioni · working tree
 *              TRACCIATO pulito? (modifiche locali a file ufficiali → STOP)
 *   DISCOVER   ultima release semver via git (o --tag esplicito) · confronto
 *   CONFIRM    conferma (salvo --yes) · --dry-run mostra il piano ed esce
 *   ── downtime ──
 *   FETCH      git fetch --tags (rete, PRIMA dello stop: un errore qui non ferma il server)
 *   BACKUP     snapshot pre-update (backupEngine)
 *   STOP       ferma il server self-managed (SIGTERM)
 *   APPLY      salva node_modules per il rollback offline · git checkout <tag>
 *   DEPS       npm install (o --clean → npm ci); il postinstall del target
 *              sincronizza le dipendenze di plugin/temi e riallinea i config vivi
 *   SMOKE      node --check index.js + risoluzione dei moduli core
 *   ROLLBACK   su errore in APPLY/DEPS/SMOKE → git checkout <ref-vecchio> +
 *              ripristino di node_modules (offline)
 *   FINALIZE   successo → libera lo spazio del rollback · istruzioni di riavvio
 *              (simmetria: NON riavvia da sé)
 *
 * Flag: --tag <v> · --clean (npm ci) · --dry-run · --yes
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');
const updateEngine = require('./lib/updateEngine');
const serverControl = require('./lib/serverControl');
const backupEngine = require('./lib/backupEngine');
const { parseArgs } = require('./lib/cliArgs');

const projectRoot = path.resolve(__dirname, '..');
const { flags } = parseArgs(process.argv.slice(2), ['tag']);
const LOCK_FILE = path.join(projectRoot, '.update.lock');

function ask(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => { rl.close(); resolve(String(a).trim()); });
  });
}
const confirm = (q) => ask(q).then((a) => /^y(es)?$/i.test(a) || /^s(i|ì)?$/i.test(a));

function fail(msg) { process.stderr.write(`✗ ${msg}\n`); process.exit(1); }

function releasesPageUrl() {
  const or = updateEngine.ownerRepo(projectRoot);
  return or ? `https://github.com/${or.owner}/${or.repo}/releases` : null;
}

function runNpm(args) {
  execFileSync('npm', [...args, '--no-audit', '--no-fund'], { cwd: projectRoot, stdio: 'inherit' });
}

async function main() {
  if (flags.help) {
    process.stdout.write('Uso: npm run update -- [--tag <v>] [--clean] [--dry-run] [--yes]\n');
    process.exit(0);
  }

  // ── PREFLIGHT ────────────────────────────────────────────────────────────
  if (!updateEngine.gitAvailable()) fail('git non è disponibile: l\'update usa la strada B (git checkout).');
  if (!updateEngine.isGitRepo(projectRoot)) {
    fail('installazione non-git: la strada B (git checkout) non è applicabile qui.\n  (il deploy da tarball/npm non è ancora supportato dall\'updater).');
  }
  if (fs.existsSync(LOCK_FILE)) {
    fail(`update già in corso? lock presente: ${path.relative(projectRoot, LOCK_FILE)}\n  Se è un residuo di un run interrotto, rimuovilo e riprova.`);
  }

  const status = await serverControl.getStatus(projectRoot).catch(() => ({ running: false, data: null }));
  if (status.running && status.data && status.data.supervisor) {
    process.stderr.write(`\n⚠ Server avviato sotto supervisor (${status.data.supervisor}).\n`);
    process.stderr.write('  L\'updater non ferma un processo supervisionato. Fermalo a mano, poi rilancia:\n');
    process.stderr.write('    sudo systemctl stop <tuo-servizio-ital8cms>   # oppure: pm2 stop <app>\n');
    process.stderr.write('  Ad update finito riavvia con lo stesso supervisor (systemctl start / pm2 start).\n');
    process.exit(1);
  }

  const tree = updateEngine.trackedTreeStatus(projectRoot);
  if (!tree.clean) {
    process.stderr.write('\n⚠ Ci sono modifiche locali a file TRACCIATI (ufficiali):\n');
    for (const f of tree.dirtyFiles.slice(0, 20)) process.stderr.write(`    ${f}\n`);
    process.stderr.write('  `git checkout <tag>` le sovrascriverebbe. Ripristina da un backup\n');
    process.stderr.write('  (npm run restore) o gestisci l\'aggiornamento manualmente. (I file non\n');
    process.stderr.write('  tracciati — dati utente, config vivi, node_modules — non sono un problema.)\n');
    process.exit(1);
  }

  // ── DISCOVER ─────────────────────────────────────────────────────────────
  const disc = updateEngine.discover(projectRoot, { tag: typeof flags.tag === 'string' ? flags.tag : undefined });
  if (disc.skipped && disc.skipped.length) {
    process.stdout.write(`ℹ tag non-semver ignorati nel calcolo della latest: ${disc.skipped.join(', ')}\n`);
  }
  if (!flags.tag) {
    if (!disc.target) fail('nessuna release con tag semver valido trovata sul remote.');
    process.stdout.write(`Versione corrente: ${disc.current || '?'}\n`);
    process.stdout.write(`Ultima release:    ${disc.target.tag} (${disc.target.version})\n`);
    if (!disc.isNewer) {
      process.stdout.write('✓ già aggiornato: nessuna versione più recente disponibile.\n');
      process.exit(0);
    }
  } else {
    process.stdout.write(`Versione corrente: ${disc.current || '?'}\n`);
    process.stdout.write(`Target richiesto:  ${disc.target.tag}${disc.target.version ? ` (${disc.target.version})` : ''}\n`);
    if (disc.exists === false) process.stdout.write('⚠ il tag non risulta tra quelli remoti noti; verrà tentato comunque dopo il fetch.\n');
  }
  const target = disc.target;
  const url = releasesPageUrl();
  if (url) process.stdout.write(`Note di release: ${url}/tag/${target.tag}\n`);

  // ── CONFIRM ──────────────────────────────────────────────────────────────
  if (!flags.yes) {
    const ok = await confirm(`\nAggiornare a ${target.tag}? Il server verrà fermato e i file allineati. [y/N] `);
    if (!ok) { process.stdout.write('Aggiornamento annullato.\n'); process.exit(0); }
  }

  if (flags['dry-run']) {
    process.stdout.write('\n[dry-run] piano:\n');
    process.stdout.write(`  1) git fetch --tags\n  2) backup pre-update\n  3) stop server\n`);
    process.stdout.write(`  4) git checkout ${target.tag}\n  5) npm ${flags.clean ? 'ci' : 'install'} (+ postinstall deps-sync)\n`);
    process.stdout.write('  6) smoke test → in caso di errore, rollback automatico\n');
    process.stdout.write('[dry-run] nessuna modifica effettuata.\n');
    process.exit(0);
  }

  // ── EXECUTE ──────────────────────────────────────────────────────────────
  fs.writeFileSync(LOCK_FILE, `${process.pid} ${new Date().toISOString()}\n`, 'utf8');
  let movedNm = false;
  let nmRollback = null;
  const nmDir = path.join(projectRoot, 'node_modules');

  try {
    // FETCH (rete, prima dello stop)
    process.stdout.write('\n⇩ git fetch --tags...\n');
    try { updateEngine.fetchTags(projectRoot); }
    catch (err) { fail(`git fetch fallito (nessuna modifica applicata): ${err.message}`); }

    // BACKUP
    process.stdout.write('⇩ backup pre-update...\n');
    const backup = backupEngine.createBackup(projectRoot, { reason: 'pre-update', label: `to-${target.version || target.tag}` });
    process.stdout.write(`  ✓ ${path.relative(projectRoot, backup.dir)}\n`);
    nmRollback = path.join(backup.dir, 'node_modules-rollback');

    // STOP
    const stop = await serverControl.stopSelfManaged(projectRoot);
    if (stop.wasRunning && !stop.stopped) {
      fs.rmSync(LOCK_FILE, { force: true });
      fail('il server non si è fermato entro il timeout. Fermalo a mano e riprova.');
    }
    if (stop.stopped) process.stdout.write('ℹ server fermato (SIGTERM).\n');

    // Record rollback ref + move node_modules aside (rollback offline).
    const rollbackRef = updateEngine.currentRef(projectRoot);
    if (fs.existsSync(nmDir)) { fs.renameSync(nmDir, nmRollback); movedNm = true; }

    const rollback = () => {
      process.stderr.write('↩ rollback in corso...\n');
      try { updateEngine.checkout(projectRoot, rollbackRef); } catch (_) {}
      try { fs.rmSync(nmDir, { recursive: true, force: true }); } catch (_) {}
      if (movedNm && fs.existsSync(nmRollback)) { try { fs.renameSync(nmRollback, nmDir); } catch (_) {} }
    };

    // APPLY
    try {
      process.stdout.write(`⇩ git checkout ${target.tag}...\n`);
      updateEngine.checkout(projectRoot, target.tag);
    } catch (err) { rollback(); fs.rmSync(LOCK_FILE, { force: true }); fail(`git checkout fallito → rollback eseguito. (${err.message})`); }

    // DEPS (il postinstall del target sincronizza plugin/temi + riallinea i vivi)
    try {
      process.stdout.write(`⇩ npm ${flags.clean ? 'ci' : 'install'}...\n`);
      runNpm(flags.clean ? ['ci'] : ['install']);
    } catch (err) { rollback(); fs.rmSync(LOCK_FILE, { force: true }); fail(`npm ${flags.clean ? 'ci' : 'install'} fallito → rollback eseguito. (${err.message})`); }

    // SMOKE
    try {
      process.stdout.write('⇩ smoke test...\n');
      execFileSync('node', ['--check', 'index.js'], { cwd: projectRoot, stdio: 'pipe' });
      execFileSync('node', ['-e', 'require.resolve("koa");require.resolve("@koa/router");require.resolve("ejs")'], { cwd: projectRoot, stdio: 'pipe' });
    } catch (err) {
      rollback(); fs.rmSync(LOCK_FILE, { force: true });
      fail(`smoke test fallito (la nuova versione non parte pulita) → rollback eseguito. (${String(err.message).split('\n')[0]})`);
    }

    // SUCCESS — libera lo spazio del node_modules vecchio.
    if (movedNm && fs.existsSync(nmRollback)) fs.rmSync(nmRollback, { recursive: true, force: true });
    process.stdout.write(`\n✓ aggiornato a ${target.tag}.\n`);
    process.stdout.write('  Riavvia con: npm start\n');
  } finally {
    try { fs.rmSync(LOCK_FILE, { force: true }); } catch (_) {}
  }
  process.exit(0);
}

main().catch((err) => {
  try { fs.rmSync(LOCK_FILE, { force: true }); } catch (_) {}
  process.stderr.write(`✗ update: ${err.message}\n`);
  process.exit(1);
});
