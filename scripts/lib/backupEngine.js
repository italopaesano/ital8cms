/**
 * backupEngine — snapshot/restore su filesystem dell'installazione ital8cms.
 *
 * Filosofia (coerente col progetto): nessuna dipendenza npm, solo built-in di
 * Node (fs.cpSync ricorsivo). Uno snapshot è una CARTELLA sotto backups/, non un
 * archivio: zero dipendenze da `tar`, ispezionabile, e restore = copia. Il campo
 * "prezzo" è l'assenza di compressione — accettabile per un CMS file-based, ed è
 * ridotto escludendo node_modules di default.
 *
 * Cosa entra nello snapshot: tutto projectRoot TRANNE:
 *   - node_modules (a ogni livello) — rigenerabile con npm (opz. incluso con withNodeModules)
 *   - backups/ — evita la ricorsione dello snapshot su se stesso
 *   - .git/ — di default incluso (restore-point completo); escludibile con includeGit:false
 *   - *.sock — socket del control plane (runtime)
 *   - .tmp — cartelle temporanee
 *
 * I dati utente e i config vivi (git-ignored: userAccount, media in www/, config
 * .json5 vivi, ecc.) SONO nello snapshot: sono la parte che conta preservare.
 *
 * Struttura di un backup:
 *   backups/backup-DD-MM-YYYY_HH-MM-SS[_label]/
 *     ├── manifest.json   (metadati: versione, sha git, node, cosa include)
 *     └── tree/           (lo snapshot dell'installazione)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BACKUP_DIRNAME = 'backups';
const TREE_SUBDIR = 'tree';
const MANIFEST_FILENAME = 'manifest.json';
const BACKUP_PREFIX = 'backup-';

// ── util ─────────────────────────────────────────────────────────────────────

function italianTimestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function sanitizeLabel(label) {
  return String(label).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40);
}

function backupRoot(projectRoot) {
  return path.join(projectRoot, BACKUP_DIRNAME);
}

function readCmsVersion(projectRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version || null;
  } catch (_) { return null; }
}

function readGitSha(projectRoot) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim() || null;
  } catch (_) { return null; }
}

/**
 * Filtro profondo per fs.cpSync: esclude node_modules (ovunque), *.sock e .tmp a
 * qualsiasi profondità. (backups/ e .git top-level sono gestiti a monte, saltando
 * l'entry di primo livello, così fs.cpSync non tenta mai di copiarsi dentro.)
 */
function makeDeepFilter(withNodeModules) {
  return (src) => {
    const base = path.basename(src);
    if (!withNodeModules && base === 'node_modules') return false;
    if (base === '.tmp') return false;
    if (base.endsWith('.sock')) return false;
    return true;
  };
}

function isExcludedTopLevel(name, { withNodeModules, includeGit }) {
  if (name === BACKUP_DIRNAME) return true;              // mai copiare i backup dentro un backup
  if (!includeGit && name === '.git') return true;
  if (!withNodeModules && name === 'node_modules') return true;
  if (name === '.tmp') return true;
  if (name.endsWith('.sock')) return true;
  return false;
}

// ── API ──────────────────────────────────────────────────────────────────────

/**
 * Crea uno snapshot dell'installazione.
 * @param {string} projectRoot
 * @param {object} [opts]
 * @param {boolean} [opts.withNodeModules=false] - includi node_modules (snapshot autonomo).
 * @param {boolean} [opts.includeGit=true] - includi .git (restore-point completo).
 * @param {string|null} [opts.label=null] - etichetta aggiunta al nome cartella.
 * @param {string} [opts.reason='manual'] - annotazione nel manifest (manual|pre-update|pre-restore).
 * @returns {{name:string, dir:string, treeDir:string, manifest:object}}
 */
function createBackup(projectRoot, opts = {}) {
  const withNodeModules = opts.withNodeModules === true;
  const includeGit = opts.includeGit !== false;
  const reason = opts.reason || 'manual';
  const label = opts.label ? sanitizeLabel(opts.label) : null;

  const name = BACKUP_PREFIX + italianTimestamp() + (label ? `_${label}` : '');
  const dir = path.join(backupRoot(projectRoot), name);
  const treeDir = path.join(dir, TREE_SUBDIR);
  fs.mkdirSync(treeDir, { recursive: true });

  const deepFilter = makeDeepFilter(withNodeModules);
  const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
  let fileCount = 0;
  for (const ent of entries) {
    const name2 = ent.name;
    if (isExcludedTopLevel(name2, { withNodeModules, includeGit })) continue;
    const src = path.join(projectRoot, name2);
    const dest = path.join(treeDir, name2);
    fs.cpSync(src, dest, { recursive: true, force: true, filter: deepFilter });
    fileCount++;
  }

  const manifest = {
    name,
    createdAt: new Date().toISOString(),
    reason,
    label,
    cmsVersion: readCmsVersion(projectRoot),
    gitSha: readGitSha(projectRoot),
    nodeVersion: process.version,
    includesNodeModules: withNodeModules,
    includesGit: includeGit,
    topLevelEntries: fileCount,
  };
  fs.writeFileSync(path.join(dir, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2), 'utf8');

  return { name, dir, treeDir, manifest };
}

/**
 * Elenca i backup presenti, dal più recente al più vecchio.
 * @param {string} projectRoot
 * @returns {Array<{name:string, dir:string, manifest:(object|null), sizeBytes:number, mtime:Date}>}
 */
function listBackups(projectRoot) {
  const root = backupRoot(projectRoot);
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory() || !ent.name.startsWith(BACKUP_PREFIX)) continue;
    const dir = path.join(root, ent.name);
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILENAME), 'utf8')); } catch (_) {}
    const stat = fs.statSync(dir);
    out.push({ name: ent.name, dir, manifest, sizeBytes: dirSize(dir), mtime: stat.mtime });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

function dirSize(dir) {
  let total = 0;
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else { try { total += fs.statSync(p).size; } catch (_) {} }
    }
  };
  try { walk(dir); } catch (_) {}
  return total;
}

/**
 * Trova un backup per nome (o accetta già un oggetto della lista).
 * @returns {object} entry della lista
 * @throws se non trovato
 */
function findBackup(projectRoot, name) {
  const all = listBackups(projectRoot);
  const found = all.find((b) => b.name === name);
  if (!found) throw new Error(`backup non trovato: ${name}`);
  return found;
}

/**
 * Elimina un backup.
 * @param {string} projectRoot
 * @param {string} name
 */
function deleteBackup(projectRoot, name) {
  const found = findBackup(projectRoot, name);
  fs.rmSync(found.dir, { recursive: true, force: true });
  return { name, removed: true };
}

/**
 * Mantiene solo gli ultimi `keep` backup, elimina i più vecchi.
 * @param {string} projectRoot
 * @param {number} keep
 * @returns {{removed:string[], kept:string[]}}
 */
function pruneBackups(projectRoot, keep) {
  const all = listBackups(projectRoot); // già ordinati recente→vecchio
  const kept = all.slice(0, Math.max(0, keep));
  const toRemove = all.slice(Math.max(0, keep));
  for (const b of toRemove) fs.rmSync(b.dir, { recursive: true, force: true });
  return { removed: toRemove.map((b) => b.name), kept: kept.map((b) => b.name) };
}

/**
 * Ripristina un backup facendo OVERLAY dello snapshot su projectRoot: i file
 * dello snapshot sovrascrivono quelli correnti; ciò che non è nello snapshot
 * (es. node_modules se escluso) resta intatto. NON rimuove i file creati dopo il
 * backup (overlay, non mirror) — scelta prudente per non cancellare dati nuovi.
 *
 * @param {string} projectRoot
 * @param {string} name
 * @returns {{name:string, restored:string[], manifest:(object|null)}}
 */
function restoreBackup(projectRoot, name) {
  const found = findBackup(projectRoot, name);
  const treeDir = path.join(found.dir, TREE_SUBDIR);
  if (!fs.existsSync(treeDir)) throw new Error(`snapshot corrotto (manca tree/): ${name}`);

  const restored = [];
  for (const ent of fs.readdirSync(treeDir, { withFileTypes: true })) {
    const src = path.join(treeDir, ent.name);
    const dest = path.join(projectRoot, ent.name);
    fs.cpSync(src, dest, { recursive: true, force: true });
    restored.push(ent.name);
  }
  return { name, restored, manifest: found.manifest };
}

function humanSize(bytes) {
  if (!Number.isFinite(bytes)) return '?';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

module.exports = {
  BACKUP_DIRNAME,
  BACKUP_PREFIX,
  TREE_SUBDIR,
  MANIFEST_FILENAME,
  createBackup,
  listBackups,
  findBackup,
  deleteBackup,
  pruneBackups,
  restoreBackup,
  humanSize,
};
