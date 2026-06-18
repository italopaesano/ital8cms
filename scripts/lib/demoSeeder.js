// Questo file segue lo standard del progetto ital8cms
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_PROJECT_ROOT = path.join(__dirname, '../..');

// Directory saltate durante la scansione dei *.demo.json5 co-locati (convenzione A)
const SCAN_SKIP_DIRS = new Set(['node_modules', '.git', 'backups', 'tests', 'scripts']);

// Top-level consentiti nel mirror .demoData/ (convenzione B)
const MIRROR_TOP_LEVEL = ['www', 'plugins', 'themes'];

/**
 * demoSeeder.js — Motore di seeding del PROFILO DI INSTALLAZIONE "demo".
 *
 * INSTALL-TIME ONLY: invocato dal wizard (scripts/init.js) nel ramo demo.
 * NON viene mai caricato dal runtime del server (index.js / pluginSys) → footprint
 * runtime zero.
 *
 * Due convenzioni di copia (vedi CLAUDE.md → "Demo Install Profile"):
 *   (A) co-locata:  plugins/<p>/<file>.demo.json5  →  plugins/<p>/<file>.json5
 *   (B) mirror:     .demoData/{www,plugins,themes}/...  →  <root>/{www,plugins,themes}/...
 *
 * Copia = merge + overwrite. Ogni file sovrascritto viene prima salvato in
 * backups/demo-<timestamp>/<relpath> (struttura relativa preservata → niente
 * collisioni di basename).
 *
 * Inoltre invoca l'hook OPZIONALE seedDemo(context) sui plugin che lo espongono
 * in plugins/<p>/scripts/init.js (per plugin che richiedono seeding programmatico
 * invece della semplice copia-file).
 *
 * @param {Object} logger - logger con info()/success()/warning()
 * @param {Object} [options]
 * @param {string} [options.projectRoot] - root del progetto (per test in isolamento)
 */
class DemoSeeder {
  constructor(logger, options = {}) {
    this.logger = logger;
    this.projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : DEFAULT_PROJECT_ROOT;
    this.pluginsDir = path.join(this.projectRoot, 'plugins');
    this.demoDataDir = path.join(this.projectRoot, '.demoData');
    this.timestamp = this.#timestamp();
    this.backupDir = path.join(this.projectRoot, 'backups', `demo-${this.timestamp}`);
    this.stats = { demoFiles: 0, mirrorFiles: 0, backedUp: 0, seedHooks: 0 };
  }

  #timestamp() {
    const n = new Date();
    const p = (x) => String(x).padStart(2, '0');
    return `${p(n.getDate())}-${p(n.getMonth() + 1)}-${n.getFullYear()}_${p(n.getHours())}-${p(n.getMinutes())}-${p(n.getSeconds())}`;
  }

  #rel(absPath) {
    return path.relative(this.projectRoot, absPath);
  }

  // Backup strutturato: copia il file esistente in backups/demo-<ts>/<relpath>,
  // preservando il path relativo alla project root (nessuna collisione di basename).
  #backupIfExists(absTarget) {
    if (!fs.existsSync(absTarget)) return;
    const dest = path.join(this.backupDir, this.#rel(absTarget));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(absTarget, dest);
    this.stats.backedUp++;
  }

  // Copia un singolo file facendo prima il backup del target preesistente.
  #copyFileWithBackup(absSrc, absTarget) {
    this.#backupIfExists(absTarget);
    fs.mkdirSync(path.dirname(absTarget), { recursive: true });
    fs.copyFileSync(absSrc, absTarget);
  }

  // ── Convenzione A: *.demo.json5 co-locati nei plugin ──────────────────────
  applyColocatedDemoFiles() {
    if (!fs.existsSync(this.pluginsDir)) return;
    const found = [];
    this.#scanDemoFiles(this.pluginsDir, found);
    for (const absDemo of found.sort()) {
      // X.demo.json5 → X.json5 (rimuove solo il segmento ".demo")
      const absTarget = absDemo.replace(/\.demo\.json5$/, '.json5');
      this.#copyFileWithBackup(absDemo, absTarget);
      this.stats.demoFiles++;
      this.logger.info(`[demo] (A) ${this.#rel(absDemo)} → ${this.#rel(absTarget)}`);
    }
  }

  #scanDemoFiles(dir, acc) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SCAN_SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        this.#scanDemoFiles(path.join(dir, entry.name), acc);
      } else if (entry.isFile() && entry.name.endsWith('.demo.json5')) {
        acc.push(path.join(dir, entry.name));
      }
    }
  }

  // ── Convenzione B: mirror .demoData/{www,plugins,themes}/ ─────────────────
  applyDemoDataMirror() {
    if (!fs.existsSync(this.demoDataDir)) {
      this.logger.info('[demo] (B) nessuna cartella .demoData/ → mirror saltato');
      return;
    }
    for (const top of MIRROR_TOP_LEVEL) {
      const src = path.join(this.demoDataDir, top);
      if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
        this.#copyTreeWithBackup(src, path.join(this.projectRoot, top));
      }
    }
  }

  #copyTreeWithBackup(srcDir, targetDir) {
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const src = path.join(srcDir, entry.name);
      const target = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        this.#copyTreeWithBackup(src, target);
      } else if (entry.isFile()) {
        this.#copyFileWithBackup(src, target);
        this.stats.mirrorFiles++;
        this.logger.info(`[demo] (B) ${this.#rel(src)} → ${this.#rel(target)}`);
      }
    }
  }

  // ── Hook opzionale seedDemo(context) nei plugin ───────────────────────────
  async #runSeedHooks() {
    if (!fs.existsSync(this.pluginsDir)) return;
    for (const pluginName of fs.readdirSync(this.pluginsDir).sort()) {
      const pluginPath = path.join(this.pluginsDir, pluginName);
      // throwIfNoEntry:false: ignora i symlink rotti in plugins/ senza crash ENOENT
      const stats = fs.statSync(pluginPath, { throwIfNoEntry: false });
      if (!stats || !stats.isDirectory()) continue;
      const initScript = path.join(pluginPath, 'scripts', 'init.js');
      if (!fs.existsSync(initScript)) continue;

      let mod;
      try {
        mod = require(initScript);
      } catch (e) {
        this.logger.warning(`[demo] init.js di ${pluginName} non caricabile: ${e.message}`);
        continue;
      }

      if (mod && typeof mod.seedDemo === 'function') {
        try {
          this.logger.info(`[demo] seedDemo() → ${pluginName}`);
          const res = await mod.seedDemo({ pathPluginFolder: pluginPath, logger: this.logger, projectRoot: this.projectRoot });
          this.stats.seedHooks++;
          if (res && res.success === false) {
            this.logger.warning(`[demo] seedDemo(${pluginName}): ${res.message || 'problema segnalato'}`);
          }
        } catch (e) {
          this.logger.warning(`[demo] seedDemo(${pluginName}) errore: ${e.message}`);
        }
      }
    }
  }

  /**
   * Esegue l'intero seeding demo: convenzione A, convenzione B, hook seedDemo.
   * @returns {Promise<Object>} statistiche
   */
  async run() {
    this.logger.info('[demo] Avvio seeding profilo demo...');
    this.applyColocatedDemoFiles(); // (A)
    this.applyDemoDataMirror();     // (B)
    await this.#runSeedHooks();     // seedDemo(context)

    this.logger.success(
      `[demo] Seeding completato: ${this.stats.demoFiles} file (A), ${this.stats.mirrorFiles} file (B), ` +
      `${this.stats.seedHooks} hook seedDemo, ${this.stats.backedUp} file di backup`
    );
    if (this.stats.backedUp > 0) {
      this.logger.info(`[demo] Backup dei file sovrascritti in: ${this.#rel(this.backupDir)}`);
    }
    return this.stats;
  }
}

module.exports = DemoSeeder;
