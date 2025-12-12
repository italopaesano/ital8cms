const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../loadJson5');

/**
 * SymlinkManager - Gestisce symlink delle sezioni admin
 *
 * Responsabilità:
 * - Crea symlink quando plugin admin viene caricato
 * - Rimuove symlink quando plugin admin viene disinstallato
 * - Valida che symlink puntino a destinazioni valide
 *
 * Workflow:
 * 1. Plugin admin ha directory con nome sezione (es. plugins/adminUsers/usersManagment/)
 * 2. Durante caricamento plugin, crea symlink:
 *    core/admin/webPages/usersManagment → plugins/adminUsers/usersManagment/
 * 3. koa-classic-server serve i file EJS attraverso il symlink
 * 4. Durante disinstallazione, rimuove symlink
 */
class SymlinkManager {
  constructor(configManager) {
    this.configManager = configManager;
    this.adminWebPagesPath = path.join(__dirname, '../webPages');
  }

  /**
   * Installa sezione di un plugin admin (crea symlink)
   * @param {object} plugin - Plugin object con pluginName, pathPluginFolder, etc.
   */
  installPluginSection(plugin) {
    const pluginPath = plugin.pathPluginFolder;
    const pluginName = plugin.pluginName;

    // 1. Verifica che sia un plugin admin
    if (!plugin.pluginConfig?.pluginType?.isAdminPlugin) {
      return; // Non è un plugin admin, skip
    }

    // 2. Verifica che abbia adminConfig.json5
    const adminConfigPath = path.join(pluginPath, 'adminConfig.json5');
    if (!fs.existsSync(adminConfigPath)) {
      console.log(`ℹ️ Plugin "${pluginName}" is admin plugin but has no adminConfig.json5, skipping section install`);
      return;
    }

    // 3. Carica adminConfig del plugin
    let adminConfig;
    try {
      adminConfig = loadJson5(adminConfigPath);
    } catch (error) {
      console.error(`✗ Failed to load adminConfig.json5 for plugin "${pluginName}":`, error.message);
      return;
    }

    // Salva adminConfig sul plugin per uso futuro
    plugin.adminConfig = adminConfig;

    // 4. Verifica che dichiari una sezione
    if (!adminConfig.adminSection?.sectionId) {
      console.log(`ℹ️ Plugin "${pluginName}" has no adminSection.sectionId, skipping section install`);
      return;
    }

    const sectionId = adminConfig.adminSection.sectionId;

    // 5. Path della directory sezione nel plugin
    const sectionSourcePath = path.join(pluginPath, sectionId);

    // 6. Verifica che la directory sezione esista nel plugin
    if (!fs.existsSync(sectionSourcePath)) {
      throw new Error(
        `Plugin "${pluginName}" declares section "${sectionId}" but directory ` +
        `"${sectionSourcePath}" does not exist`
      );
    }

    // 7. Path del symlink in admin/webPages
    const symlinkPath = path.join(this.adminWebPagesPath, sectionId);

    // 8. Verifica conflitti
    if (fs.existsSync(symlinkPath)) {
      const stats = fs.lstatSync(symlinkPath);

      if (stats.isSymbolicLink()) {
        // Esiste già un symlink
        const currentTarget = fs.readlinkSync(symlinkPath);

        if (currentTarget === sectionSourcePath) {
          // Symlink già corretto
          console.log(`✓ Symlink already exists for section "${sectionId}" (plugin "${pluginName}")`);
          return;
        } else {
          // Symlink esiste ma punta altrove!
          throw new Error(
            `Section "${sectionId}" symlink already exists, pointing to:\n` +
            `  Current: ${currentTarget}\n` +
            `  New: ${sectionSourcePath}\n` +
            `  Conflict! Another plugin may be using this section.`
          );
        }
      } else {
        // Esiste ma non è un symlink (directory hardcoded?)
        throw new Error(
          `Section "${sectionId}" directory already exists at "${symlinkPath}" ` +
          `but is not a symlink. Cannot install plugin "${pluginName}".`
        );
      }
    }

    // 9. Crea symlink
    try {
      fs.symlinkSync(sectionSourcePath, symlinkPath, 'dir');
      console.log(`✓ Created symlink for section "${sectionId}": ${symlinkPath} → ${sectionSourcePath}`);
    } catch (error) {
      console.error(`✗ Failed to create symlink for section "${sectionId}":`, error.message);
      throw error;
    }
  }

  /**
   * Disinstalla sezione di un plugin admin (rimuove symlink)
   * @param {object} plugin - Plugin object
   */
  uninstallPluginSection(plugin) {
    const pluginName = plugin.pluginName;

    // 1. Verifica che abbia adminConfig
    if (!plugin.adminConfig?.adminSection?.sectionId) {
      return; // Nessuna sezione da rimuovere
    }

    const sectionId = plugin.adminConfig.adminSection.sectionId;
    const symlinkPath = path.join(this.adminWebPagesPath, sectionId);

    // 2. Verifica che il symlink esista
    if (!fs.existsSync(symlinkPath)) {
      console.log(`ℹ️ Symlink for section "${sectionId}" not found, nothing to remove`);
      return;
    }

    // 3. Verifica che sia un symlink
    const stats = fs.lstatSync(symlinkPath);
    if (!stats.isSymbolicLink()) {
      console.warn(`⚠️ Section "${sectionId}" at "${symlinkPath}" is not a symlink, skipping removal`);
      return;
    }

    // 4. Verifica che punti al plugin corretto (safety check)
    const currentTarget = fs.readlinkSync(symlinkPath);
    const expectedTarget = path.join(plugin.pathPluginFolder, sectionId);

    if (currentTarget !== expectedTarget) {
      console.warn(
        `⚠️ Symlink for section "${sectionId}" points to different location:\n` +
        `  Current: ${currentTarget}\n` +
        `  Expected: ${expectedTarget}\n` +
        `  Skipping removal for safety.`
      );
      return;
    }

    // 5. Rimuovi symlink
    try {
      fs.unlinkSync(symlinkPath);
      console.log(`✓ Removed symlink for section "${sectionId}": ${symlinkPath}`);
    } catch (error) {
      console.error(`✗ Failed to remove symlink for section "${sectionId}":`, error.message);
      throw error;
    }
  }

  /**
   * Valida tutti i symlink esistenti
   * (chiamato all'avvio per verificare integrità)
   */
  validateSymlinks() {
    const config = this.configManager.getConfig();

    for (const [sectionId, sectionConfig] of Object.entries(config.sections)) {
      if (sectionConfig.type !== 'plugin') {
        continue; // Solo sezioni plugin hanno symlink
      }

      const symlinkPath = path.join(this.adminWebPagesPath, sectionId);

      // Controlla se il symlink esiste (anche se rotto)
      let symlinkExists = false;
      let stats = null;
      try {
        stats = fs.lstatSync(symlinkPath);
        symlinkExists = true;
      } catch (error) {
        if (error.code === 'ENOENT') {
          // Symlink non esiste
          if (sectionConfig.enabled && sectionConfig.required) {
            console.warn(`⚠️ Required symlink for section "${sectionId}" (plugin "${sectionConfig.plugin}") does not exist`);
          }
          continue;
        }
        // Altri errori
        console.error(`⚠️ Error checking symlink for section "${sectionId}":`, error.message);
        continue;
      }

      if (!stats.isSymbolicLink()) {
        console.warn(`⚠️ Section "${sectionId}" is not a symlink`);
        continue;
      }

      // Verifica che il target esista
      const target = fs.readlinkSync(symlinkPath);
      if (!fs.existsSync(target)) {
        console.warn(`⚠️ Symlink for section "${sectionId}" points to non-existent target: ${target}`);
        console.warn(`⚠️ Removing broken symlink: ${symlinkPath}`);
        try {
          fs.unlinkSync(symlinkPath);
          console.log(`✓ Broken symlink removed for section "${sectionId}"`);
        } catch (unlinkError) {
          console.error(`✗ Failed to remove broken symlink:`, unlinkError.message);
        }
      }
    }
  }
}

module.exports = SymlinkManager;
