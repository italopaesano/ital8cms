const fs = require('fs');
const path = require('path');

/**
 * PluginPagesSystem - Gestisce le pagine pubbliche dei plugin
 *
 * Questo sistema:
 * - Rileva automaticamente plugin con directory webPages/
 * - Crea symlink in /pluginPages/ per servire i file
 * - Permette ai plugin di servire pagine pubbliche senza endpoint manuali
 *
 * Convenzioni:
 * - Se esiste plugins/{pluginName}/webPages/ → crea symlink automaticamente
 * - URL pattern: /{pluginPagesPrefix}/{pluginName}/{file.ejs}
 * - No configurazione necessaria in pluginConfig.json5
 */
class PluginPagesSystem {
  constructor(pluginSys) {
    this.pluginSys = pluginSys;

    // Hardcoded: directory path alla root del progetto
    this.pluginPagesDir = path.join(__dirname, '..', 'pluginPages');

    console.log(`[PluginPagesSystem] Initialized with directory: ${this.pluginPagesDir}`);
  }

  /**
   * Inizializza il sistema:
   * - Crea directory /pluginPages/ se non esiste
   * - Valida e pulisce symlink esistenti (rimuove rotti)
   * - Scansiona tutti i plugin attivi
   * - Crea/ricrea symlink per plugin con directory webPages/
   */
  initialize() {
    console.log('[PluginPagesSystem] Starting initialization...');

    // Crea directory centrale se non esiste
    if (!fs.existsSync(this.pluginPagesDir)) {
      try {
        fs.mkdirSync(this.pluginPagesDir, { recursive: true });
        console.log(`[PluginPagesSystem] Created directory: ${this.pluginPagesDir}`);
      } catch (error) {
        console.error(`[PluginPagesSystem] Failed to create directory: ${error.message}`);
        return;
      }
    }

    // IMPORTANTE: Valida e pulisci symlink esistenti prima di creare nuovi
    this.validateAndCleanSymlinks();

    // Ottieni tutti i plugin attivi
    const allPlugins = this.pluginSys.getAllPlugins();
    let processedCount = 0;
    let symlinkCount = 0;

    // getAllPlugins() restituisce un array, non un oggetto
    // Ogni plugin ha già pluginName e pathPluginFolder come proprietà
    for (const plugin of allPlugins) {
      processedCount++;

      // Verifica se il plugin ha la directory webPages/
      const webPagesDir = path.join(plugin.pathPluginFolder, 'webPages');

      if (fs.existsSync(webPagesDir)) {
        const stats = fs.statSync(webPagesDir);
        if (stats.isDirectory()) {
          this.createSymlinkForPlugin(plugin.pluginName, webPagesDir);
          symlinkCount++;
        } else {
          console.warn(`[PluginPagesSystem] ${plugin.pluginName}: webPages exists but is not a directory`);
        }
      }
    }

    console.log(`[PluginPagesSystem] Initialization complete: ${processedCount} plugins scanned, ${symlinkCount} symlinks created/verified`);
  }

  /**
   * Crea symlink per un plugin specifico
   * @param {string} pluginName - Nome del plugin
   * @param {string} sourceDir - Path assoluto della directory sorgente (webPages/)
   */
  createSymlinkForPlugin(pluginName, sourceDir) {
    const targetSymlink = path.join(this.pluginPagesDir, pluginName);

    // Verifica se il symlink esiste (anche se rotto)
    // IMPORTANTE: Usiamo lstatSync invece di existsSync perché existsSync restituisce false
    // per symlink rotti (che puntano a target inesistenti)
    let symlinkExists = false;
    try {
      fs.lstatSync(targetSymlink);
      symlinkExists = true;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`[PluginPagesSystem] Error checking symlink: ${error.message}`);
        return;
      }
      // ENOENT = symlink non esiste, ok procedere
    }

    if (symlinkExists) {
      const stats = fs.lstatSync(targetSymlink);

      if (stats.isSymbolicLink()) {
        const currentTarget = fs.readlinkSync(targetSymlink);

        if (currentTarget === sourceDir) {
          console.log(`[PluginPagesSystem] Symlink already valid: ${pluginName} → ${sourceDir}`);
          return;
        } else {
          console.warn(`[PluginPagesSystem] Symlink conflict detected for ${pluginName}`);
          console.warn(`  Current target: ${currentTarget}`);
          console.warn(`  Expected target: ${sourceDir}`);
          console.warn(`  Removing and recreating symlink...`);

          // Rimuovi symlink invalido
          try {
            fs.unlinkSync(targetSymlink);
          } catch (error) {
            console.error(`[PluginPagesSystem] Failed to remove invalid symlink: ${error.message}`);
            return;
          }
        }
      } else {
        console.error(`[PluginPagesSystem] ERROR: ${targetSymlink} exists but is not a symlink!`);
        console.error(`  This may be a regular file or directory that conflicts with plugin name.`);
        console.error(`  Please remove it manually to allow symlink creation.`);
        return;
      }
    }

    // Crea symlink
    try {
      fs.symlinkSync(sourceDir, targetSymlink, 'dir');
      console.log(`[PluginPagesSystem] Created symlink: ${pluginName} → ${sourceDir}`);
    } catch (error) {
      console.error(`[PluginPagesSystem] Failed to create symlink for ${pluginName}: ${error.message}`);
    }
  }

  /**
   * Rimuove symlink per un plugin (chiamato durante uninstall)
   * @param {string} pluginName - Nome del plugin
   */
  removeSymlinkForPlugin(pluginName) {
    const targetSymlink = path.join(this.pluginPagesDir, pluginName);

    if (!fs.existsSync(targetSymlink)) {
      console.log(`[PluginPagesSystem] Symlink does not exist: ${pluginName}`);
      return;
    }

    const stats = fs.lstatSync(targetSymlink);

    if (stats.isSymbolicLink()) {
      try {
        fs.unlinkSync(targetSymlink);
        console.log(`[PluginPagesSystem] Removed symlink: ${pluginName}`);
      } catch (error) {
        console.error(`[PluginPagesSystem] Failed to remove symlink: ${error.message}`);
      }
    } else {
      console.warn(`[PluginPagesSystem] Cannot remove ${targetSymlink}: not a symlink`);
    }
  }

  /**
   * Ottiene il path della directory pluginPages
   * @returns {string} - Path assoluto
   */
  getPluginPagesDirectory() {
    return this.pluginPagesDir;
  }

  /**
   * Verifica se un plugin ha pagine pubbliche (directory webPages/)
   * @param {string} pluginName - Nome del plugin
   * @returns {boolean}
   */
  hasPublicPages(pluginName) {
    const plugin = this.pluginSys.getPlugin(pluginName);
    if (!plugin) return false;

    const webPagesDir = path.join(plugin.pathPluginFolder, 'webPages');
    return fs.existsSync(webPagesDir) && fs.statSync(webPagesDir).isDirectory();
  }

  /**
   * Valida e pulisce symlink esistenti nella directory pluginPages/
   * - Rimuove symlink rotti (che puntano a target inesistenti)
   * - Rimuove symlink che puntano a plugin disattivi
   * - Rimuove symlink orfani (per plugin che non esistono più)
   *
   * Chiamato all'avvio per garantire uno stato consistente
   */
  validateAndCleanSymlinks() {
    if (!fs.existsSync(this.pluginPagesDir)) {
      return; // Directory non esiste ancora, niente da validare
    }

    console.log('[PluginPagesSystem] Validating existing symlinks...');

    let removedCount = 0;
    let validCount = 0;

    // Ottieni tutti i file/symlink nella directory pluginPages/
    const entries = fs.readdirSync(this.pluginPagesDir);

    for (const entry of entries) {
      const symlinkPath = path.join(this.pluginPagesDir, entry);

      // Usa lstatSync per rilevare anche symlink rotti
      let stats = null;
      try {
        stats = fs.lstatSync(symlinkPath);
      } catch (error) {
        console.warn(`[PluginPagesSystem] Error checking entry "${entry}": ${error.message}`);
        continue;
      }

      // Verifica che sia un symlink
      if (!stats.isSymbolicLink()) {
        console.warn(`[PluginPagesSystem] Entry "${entry}" is not a symlink, skipping`);
        continue;
      }

      // Leggi il target del symlink
      let targetPath = null;
      try {
        targetPath = fs.readlinkSync(symlinkPath);
      } catch (error) {
        console.warn(`[PluginPagesSystem] Cannot read symlink target for "${entry}": ${error.message}`);
        continue;
      }

      // Verifica che il target esista
      if (!fs.existsSync(targetPath)) {
        console.warn(`[PluginPagesSystem] Symlink "${entry}" points to non-existent target: ${targetPath}`);
        console.warn(`[PluginPagesSystem] Removing broken symlink...`);
        try {
          fs.unlinkSync(symlinkPath);
          removedCount++;
          console.log(`[PluginPagesSystem] ✓ Removed broken symlink: ${entry}`);
        } catch (unlinkError) {
          console.error(`[PluginPagesSystem] ✗ Failed to remove symlink: ${unlinkError.message}`);
        }
        continue;
      }

      // Verifica che il plugin corrispondente sia ancora attivo
      const pluginName = entry; // Nome del symlink = nome del plugin
      const plugin = this.pluginSys.getPlugin(pluginName);

      if (!plugin) {
        console.warn(`[PluginPagesSystem] Symlink "${entry}" points to plugin that no longer exists or is inactive`);
        console.warn(`[PluginPagesSystem] Removing orphaned symlink...`);
        try {
          fs.unlinkSync(symlinkPath);
          removedCount++;
          console.log(`[PluginPagesSystem] ✓ Removed orphaned symlink: ${entry}`);
        } catch (unlinkError) {
          console.error(`[PluginPagesSystem] ✗ Failed to remove symlink: ${unlinkError.message}`);
        }
        continue;
      }

      // Symlink è valido
      validCount++;
    }

    console.log(`[PluginPagesSystem] Validation complete: ${validCount} valid, ${removedCount} removed`);
  }

  /**
   * Lista tutti i plugin con pagine pubbliche
   * @returns {Array<string>} - Array di nomi plugin
   */
  getPluginsWithPublicPages() {
    const allPlugins = this.pluginSys.getAllPlugins();
    const pluginsWithPages = [];

    // getAllPlugins() restituisce un array, non un oggetto
    for (const plugin of allPlugins) {
      const webPagesDir = path.join(plugin.pathPluginFolder, 'webPages');
      if (fs.existsSync(webPagesDir) && fs.statSync(webPagesDir).isDirectory()) {
        pluginsWithPages.push(plugin.pluginName);
      }
    }

    return pluginsWithPages;
  }
}

module.exports = PluginPagesSystem;
