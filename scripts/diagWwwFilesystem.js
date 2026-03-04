#!/usr/bin/env node

/**
 * diagWwwFilesystem.js
 *
 * Script diagnostico per analizzare il comportamento del filesystem
 * nella directory www/ — utile per individuare bug specifici di NixOS
 * buildFHSEnv dove readdir può restituire DT_UNKNOWN (tipo 0) o symlink
 * verso il Nix store, causando il fallimento di findIndexFile in
 * koa-classic-server.
 *
 * Esecuzione:
 *   node scripts/diagWwwFilesystem.js
 *
 * Cosa controlla:
 *   1. Tipo dirent di ogni file in www/ (isFile, isSymbolicLink, DT_UNKNOWN)
 *   2. Stat vs lstat per www/index.ejs (segue symlink vs non segue)
 *   3. Simulazione di isFileOrSymlinkToFile (come usata da koa-classic-server)
 *   4. Simulazione di findIndexFile con pattern ['index.ejs']
 *   5. Stat diretto su www/index.ejs (test GET /index.ejs)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  dim:    '\x1b[2m',
};

const wwwDir = path.join(__dirname, '..', 'www');

function pass(msg) { console.log(`  ${c.green}✓${c.reset} ${msg}`); }
function fail(msg) { console.log(`  ${c.red}✗${c.reset} ${msg}`); }
function info(msg) { console.log(`  ${c.cyan}ℹ${c.reset} ${msg}`); }
function warn(msg) { console.log(`  ${c.yellow}⚠${c.reset} ${msg}`); }

/**
 * Replica esatta di isFileOrSymlinkToFile da koa-classic-server v2.6.1
 */
async function isFileOrSymlinkToFile(dirent, dirPath) {
  if (dirent.isFile()) return { result: true, reason: 'isFile()' };
  if (dirent.isSymbolicLink()) {
    try {
      const realStat = await fs.promises.stat(path.join(dirPath, dirent.name));
      return {
        result: realStat.isFile(),
        reason: realStat.isFile() ? 'symlink → stat().isFile()' : 'symlink → stat() NOT a file'
      };
    } catch (err) {
      return { result: false, reason: `symlink → stat() ERROR: ${err.code}` };
    }
  }
  // DT_UNKNOWN fallback
  if (!dirent.isDirectory() && !dirent.isBlockDevice() && !dirent.isCharacterDevice() && !dirent.isFIFO() && !dirent.isSocket()) {
    try {
      const realStat = await fs.promises.stat(path.join(dirPath, dirent.name));
      return {
        result: realStat.isFile(),
        reason: realStat.isFile() ? 'DT_UNKNOWN fallback → stat().isFile()' : 'DT_UNKNOWN fallback → stat() NOT a file'
      };
    } catch (err) {
      return { result: false, reason: `DT_UNKNOWN fallback → stat() ERROR: ${err.code}` };
    }
  }
  return { result: false, reason: 'isDirectory() or special device' };
}

function getDirentTypeNumber(dirent) {
  const symbols = Object.getOwnPropertySymbols(dirent);
  if (symbols.length > 0) {
    const typeVal = dirent[symbols[0]];
    return typeof typeVal === 'number' ? typeVal : null;
  }
  return null;
}

function typeLabel(num) {
  switch (num) {
    case 0: return 'DT_UNKNOWN';
    case 1: return 'DT_REG (file)';
    case 2: return 'DT_DIR (directory)';
    case 3: return 'DT_LNK (symlink)';
    default: return `type=${num}`;
  }
}

(async () => {
  console.log(`\n${c.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
  console.log(`${c.bold}  DIAGNOSTICA FILESYSTEM www/ — NixOS buildFHSEnv debug${c.reset}`);
  console.log(`${c.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}\n`);

  info(`www directory: ${wwwDir}`);
  info(`IN_NIX_SHELL: ${process.env.IN_NIX_SHELL || '(non impostato)'}`);
  info(`Node.js: ${process.version}`);
  info(`Platform: ${process.platform}`);
  console.log();

  // ── Fase 1: Verifica esistenza directory www ──
  console.log(`${c.bold}Fase 1 — Esistenza directory www/${c.reset}`);
  try {
    const dirStat = await fs.promises.stat(wwwDir);
    if (dirStat.isDirectory()) {
      pass(`www/ esiste ed è una directory`);
    } else {
      fail(`www/ esiste ma NON è una directory (è un file?)`);
    }
  } catch (err) {
    fail(`www/ non accessibile: ${err.code} ${err.message}`);
    process.exit(1);
  }
  console.log();

  // ── Fase 2: readdir con dirent types ──
  console.log(`${c.bold}Fase 2 — readdir({ withFileTypes: true }) su www/${c.reset}`);
  const entries = await fs.promises.readdir(wwwDir, { withFileTypes: true });
  info(`Totale entries: ${entries.length}`);
  console.log();

  let hasDtUnknown = false;
  let hasSymlinks = false;
  let indexEjsDirent = null;

  for (const entry of entries) {
    const typeNum = getDirentTypeNumber(entry);
    const label = typeNum !== null ? typeLabel(typeNum) : '(Symbol non trovato)';

    const flags = [];
    if (entry.isFile()) flags.push('isFile');
    if (entry.isDirectory()) flags.push('isDir');
    if (entry.isSymbolicLink()) flags.push('isSymlink');
    if (flags.length === 0) flags.push('NESSUN is*() true');

    if (typeNum === 0) hasDtUnknown = true;
    if (typeNum === 3 || entry.isSymbolicLink()) hasSymlinks = true;
    if (entry.name === 'index.ejs') indexEjsDirent = entry;

    const color = typeNum === 0 ? c.yellow : typeNum === 3 ? c.cyan : c.dim;
    console.log(`  ${color}[${label}]${c.reset} ${entry.name}  ${c.dim}(${flags.join(', ')})${c.reset}`);
  }

  console.log();
  if (hasDtUnknown) {
    warn(`DT_UNKNOWN (tipo 0) rilevato! Filesystem overlay/FUSE — koa-classic-server deve usare stat() fallback`);
  }
  if (hasSymlinks) {
    warn(`Symlink rilevati! koa-classic-server deve seguirli con stat()`);
  }
  if (!hasDtUnknown && !hasSymlinks) {
    pass(`Tutti i file hanno tipo standard (1=file, 2=dir) — nessun fallback necessario`);
  }
  console.log();

  // ── Fase 3: Analisi specifica index.ejs ──
  console.log(`${c.bold}Fase 3 — Analisi specifica di index.ejs${c.reset}`);
  const indexPath = path.join(wwwDir, 'index.ejs');

  // 3a. readdir ha trovato index.ejs?
  if (indexEjsDirent) {
    pass(`readdir contiene "index.ejs"`);
    const typeNum = getDirentTypeNumber(indexEjsDirent);
    info(`  dirent type: ${typeLabel(typeNum)} (raw=${typeNum})`);
    info(`  isFile(): ${indexEjsDirent.isFile()}`);
    info(`  isSymbolicLink(): ${indexEjsDirent.isSymbolicLink()}`);
    info(`  isDirectory(): ${indexEjsDirent.isDirectory()}`);
  } else {
    fail(`readdir NON contiene "index.ejs" — FILE MANCANTE?`);
    console.log();
    console.log(`${c.red}  DIAGNOSI: index.ejs non esiste nella directory www/.`);
    console.log(`  Questo spiega sia "Index of /" che il 404 su /index.ejs.${c.reset}`);
    process.exit(1);
  }
  console.log();

  // 3b. fs.existsSync
  info(`fs.existsSync("${indexPath}"): ${fs.existsSync(indexPath)}`);

  // 3c. stat (segue symlink)
  try {
    const statResult = await fs.promises.stat(indexPath);
    pass(`fs.promises.stat() OK — isFile: ${statResult.isFile()}, size: ${statResult.size} bytes`);
  } catch (err) {
    fail(`fs.promises.stat() FALLITO: ${err.code} ${err.message}`);
    console.log(`${c.red}  DIAGNOSI: stat() fallisce su index.ejs.`);
    console.log(`  Se è un symlink, potrebbe essere rotto o puntare a un path inesistente.${c.reset}`);
  }

  // 3d. lstat (NON segue symlink)
  try {
    const lstatResult = await fs.promises.lstat(indexPath);
    info(`fs.promises.lstat() — isFile: ${lstatResult.isFile()}, isSymlink: ${lstatResult.isSymbolicLink()}`);
    if (lstatResult.isSymbolicLink()) {
      try {
        const target = await fs.promises.readlink(indexPath);
        info(`  symlink target: ${target}`);
        // Verifica che il target esista
        try {
          await fs.promises.stat(indexPath);
          pass(`  symlink target è accessibile`);
        } catch (err) {
          fail(`  symlink target NON accessibile: ${err.code}`);
        }
      } catch (err) {
        warn(`  readlink fallito: ${err.code}`);
      }
    }
  } catch (err) {
    fail(`fs.promises.lstat() FALLITO: ${err.code} ${err.message}`);
  }
  console.log();

  // ── Fase 4: Simulazione isFileOrSymlinkToFile ──
  console.log(`${c.bold}Fase 4 — Simulazione isFileOrSymlinkToFile (koa-classic-server v2.6.1)${c.reset}`);
  if (indexEjsDirent) {
    const { result, reason } = await isFileOrSymlinkToFile(indexEjsDirent, wwwDir);
    if (result) {
      pass(`isFileOrSymlinkToFile("index.ejs") → TRUE  (via: ${reason})`);
    } else {
      fail(`isFileOrSymlinkToFile("index.ejs") → FALSE  (via: ${reason})`);
      console.log(`${c.red}  DIAGNOSI: Questo è il BUG! koa-classic-server non riconosce index.ejs come file.`);
      console.log(`  findIndexFile() restituirà null → directory listing su GET /`);
      console.log(`  Probabile causa: dirent type non gestito o stat() fallisce.${c.reset}`);
    }
  }
  console.log();

  // ── Fase 5: Simulazione findIndexFile ──
  console.log(`${c.bold}Fase 5 — Simulazione findIndexFile(['index.ejs'])${c.reset}`);
  const fileCheckResults = await Promise.all(
    entries.map(async dirent => ({
      name: dirent.name,
      isFile: (await isFileOrSymlinkToFile(dirent, wwwDir)).result
    }))
  );
  const fileNames = fileCheckResults.filter(e => e.isFile).map(e => e.name);
  info(`File riconosciuti da isFileOrSymlinkToFile: [${fileNames.join(', ')}]`);

  if (fileNames.includes('index.ejs')) {
    pass(`"index.ejs" trovato nella lista dei file → findIndexFile restituirebbe il file`);
  } else {
    fail(`"index.ejs" NON trovato nella lista dei file → findIndexFile restituirebbe null`);
    console.log(`${c.red}  CONSEGUENZA: GET / mostra "Index of /" (directory listing)${c.reset}`);
  }
  console.log();

  // ── Fase 6: Verifica path risolto (come koa-classic-server) ──
  console.log(`${c.bold}Fase 6 — Path resolution (come koa-classic-server)${c.reset}`);
  const normalizedRootDir = path.resolve(wwwDir);
  info(`normalizedRootDir: ${normalizedRootDir}`);

  const fullPathForIndex = path.join(normalizedRootDir, '/index.ejs');
  info(`fullPath per /index.ejs: ${fullPathForIndex}`);
  info(`startsWith check: ${fullPathForIndex.startsWith(normalizedRootDir)}`);

  try {
    const statForDirect = await fs.promises.stat(fullPathForIndex);
    pass(`stat("${fullPathForIndex}") OK — isFile: ${statForDirect.isFile()}, size: ${statForDirect.size}`);
  } catch (err) {
    fail(`stat("${fullPathForIndex}") FALLITO: ${err.code}`);
    console.log(`${c.red}  DIAGNOSI: Questo spiega il 404 su GET /index.ejs`);
    console.log(`  Il file non può essere letto via stat() dal path assoluto.${c.reset}`);
  }
  console.log();

  // ── Riepilogo ──
  console.log(`${c.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
  console.log(`${c.bold}  RIEPILOGO${c.reset}`);
  console.log(`${c.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);

  const issues = [];
  if (hasDtUnknown) issues.push('DT_UNKNOWN entries presenti (overlayfs/FUSE/NixOS)');
  if (hasSymlinks) issues.push('Symlink presenti nel filesystem');
  if (indexEjsDirent && !fileNames.includes('index.ejs')) issues.push('index.ejs non riconosciuto come file da isFileOrSymlinkToFile');
  if (!indexEjsDirent) issues.push('index.ejs non presente in readdir');

  try {
    await fs.promises.stat(fullPathForIndex);
  } catch {
    issues.push('stat() diretto su www/index.ejs fallisce');
  }

  if (issues.length === 0) {
    console.log(`\n  ${c.green}${c.bold}Nessun problema rilevato!${c.reset}`);
    console.log(`  ${c.green}Il filesystem www/ funziona correttamente.${c.reset}`);
    console.log(`  ${c.green}Se i test e2e falliscono ancora, il problema potrebbe essere altrove.${c.reset}\n`);
  } else {
    console.log(`\n  ${c.red}${c.bold}Problemi rilevati:${c.reset}`);
    issues.forEach(issue => console.log(`  ${c.red}  • ${issue}${c.reset}`));
    console.log();
    console.log(`  ${c.yellow}Azioni suggerite:${c.reset}`);
    console.log(`  ${c.yellow}  1. Se DT_UNKNOWN: verificare che koa-classic-server v2.6.1+ sia installato${c.reset}`);
    console.log(`  ${c.yellow}  2. Se stat() fallisce: verificare permessi e target dei symlink${c.reset}`);
    console.log(`  ${c.yellow}  3. Condividere l'output di questo script con il maintainer di koa-classic-server${c.reset}`);
    console.log();
  }

})().catch(err => {
  console.error(`${c.red}Errore imprevisto: ${err.stack}${c.reset}`);
  process.exit(1);
});
