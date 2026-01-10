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
 * 1. Plugin admin (nome inizia con 'admin') ha sezioni organizzate in adminWebSections/ (es. plugins/adminUsers/adminWebSections/usersManagment/)
 * 2. Durante caricamento plugin, crea symlink per ogni sezione in adminSections array:
 *    core/admin/webPages/usersManagment → plugins/adminUsers/adminWebSections/usersManagment/
 * 3. koa-classic-server serve i file EJS attraverso il symlink
 * 4. Durante disinstallazione, rimuove symlink
 *
 * CONVENZIONE IMPORTANTE:
 * - Plugin con nome che inizia per "admin" sono automaticamente considerati plugin admin
 * - Le sezioni sono dichiarate in pluginConfig.json5 come array di stringhe (sectionId)
 * - I metadata UI (label, icon, description) sono centralizzati in /core/admin/adminConfig.json5
 * - Ogni sezione DEVE avere una directory corrispondente in adminWebSections/ del plugin
 */
class SymlinkManager {
  constructor(configManager) {
    this.configManager = configManager;
    this.adminWebPagesPath = path.join(__dirname, '../webPages');
  }

  /**
   * Installa sezioni di un plugin admin (crea symlink)
   * @param {object} plugin - Plugin object con pluginName, pathPluginFolder, etc.
   */
  installPluginSection(plugin) {
    const pluginPath = plugin.pathPluginFolder;
    const pluginName = plugin.pluginName;

    // 1. Verifica che sia un plugin admin (CONVENZIONE: nome inizia con 'admin')
    if (!pluginName.startsWith('admin')) {
      return; // Non è un plugin admin, skip
    }

    // 2. Verifica che abbia adminSections array in pluginConfig
    const adminSections = plugin.pluginConfig?.adminSections;
    if (!adminSections || !Array.isArray(adminSections) || adminSections.length === 0) {
      console.log(`ℹ️ Plugin "${pluginName}" is admin plugin but has no adminSections array, skipping section install`);
      return;
    }

    // Salva adminSections sul plugin per uso futuro (es. AdminSystem)
    plugin.adminSections = adminSections;

    // 3. Processa ogni sezione nell'array (ogni elemento è un sectionId stringa)
    for (const sectionId of adminSections) {
      if (!sectionId || typeof sectionId !== 'string') {
        console.warn(`⚠️ Plugin "${pluginName}" has invalid sectionId (must be string), skipping`);
        continue;
      }

      // 4. Path della directory sezione nel plugin (dentro adminWebSections/)
      const sectionSourcePath = path.join(pluginPath, 'adminWebSections', sectionId);

      // 5. Verifica che la directory sezione esista nel plugin
      if (!fs.existsSync(sectionSourcePath)) {
        throw new Error(
          `Plugin "${pluginName}" declares section "${sectionId}" but directory ` +
          `"${sectionSourcePath}" does not exist`
        );
      }

      // 6. Path del symlink in admin/webPages
      const symlinkPath = path.join(this.adminWebPagesPath, sectionId);

      // 7. Verifica conflitti (usando lstatSync per rilevare anche symlink rotti)
      let symlinkExists = false;
      try {
        fs.lstatSync(symlinkPath);
        symlinkExists = true;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error(`✗ Error checking symlink for section "${sectionId}":`, error.message);
          throw error;
        }
        // ENOENT = symlink non esiste, ok procedere
      }

      if (symlinkExists) {
        const stats = fs.lstatSync(symlinkPath);

        if (stats.isSymbolicLink()) {
          // Esiste già un symlink
          const currentTarget = fs.readlinkSync(symlinkPath);

          if (currentTarget === sectionSourcePath) {
            // Symlink già corretto
            console.log(`✓ Symlink already exists for section "${sectionId}" (plugin "${pluginName}")`);
            continue;
          } else {
            // Symlink esiste ma punta altrove - rimuovi e ricrea
            console.warn(`⚠️ Symlink for section "${sectionId}" points to wrong location, recreating...`);
            console.warn(`  Current: ${currentTarget}`);
            console.warn(`  Expected: ${sectionSourcePath}`);
            try {
              fs.unlinkSync(symlinkPath);
            } catch (unlinkError) {
              throw new Error(`Failed to remove invalid symlink: ${unlinkError.message}`);
            }
          }
        } else {
          // Esiste ma non è un symlink (directory hardcoded?)
          throw new Error(
            `Section "${sectionId}" directory already exists at "${symlinkPath}" ` +
            `but is not a symlink. Cannot install plugin "${pluginName}".`
          );
        }
      }

      // 8. Crea symlink
      try {
        fs.symlinkSync(sectionSourcePath, symlinkPath, 'dir');
        console.log(`✓ Created symlink for section "${sectionId}": ${symlinkPath} → ${sectionSourcePath}`);
      } catch (error) {
        console.error(`✗ Failed to create symlink for section "${sectionId}":`, error.message);
        throw error;
      }
    }
  }

  /**
   * Disinstalla sezioni di un plugin admin (rimuove symlink)
   * @param {object} plugin - Plugin object
   */
  uninstallPluginSection(plugin) {
    const pluginName = plugin.pluginName;

    // 1. Verifica che abbia adminSections
    if (!plugin.adminSections || !Array.isArray(plugin.adminSections) || plugin.adminSections.length === 0) {
      return; // Nessuna sezione da rimuovere
    }

    // 2. Rimuovi symlink per ogni sezione (ogni elemento è un sectionId stringa)
    for (const sectionId of plugin.adminSections) {
      if (!sectionId || typeof sectionId !== 'string') {
        continue;
      }

      const symlinkPath = path.join(this.adminWebPagesPath, sectionId);

      // 3. Verifica che il symlink esista (usando lstatSync per rilevare anche symlink rotti)
      let symlinkExists = false;
      let stats = null;
      try {
        stats = fs.lstatSync(symlinkPath);
        symlinkExists = true;
      } catch (error) {
        if (error.code === 'ENOENT') {
          console.log(`ℹ️ Symlink for section "${sectionId}" not found, nothing to remove`);
          continue;
        }
        console.error(`✗ Error checking symlink for section "${sectionId}":`, error.message);
        throw error;
      }

      // 4. Verifica che sia un symlink
      if (!stats.isSymbolicLink()) {
        console.warn(`⚠️ Section "${sectionId}" at "${symlinkPath}" is not a symlink, skipping removal`);
        continue;
      }

      // 5. Verifica che punti al plugin corretto (safety check)
      const currentTarget = fs.readlinkSync(symlinkPath);
      const expectedTarget = path.join(plugin.pathPluginFolder, 'adminWebSections', sectionId);

      if (currentTarget !== expectedTarget) {
        console.warn(
          `⚠️ Symlink for section "${sectionId}" points to different location:\n` +
          `  Current: ${currentTarget}\n` +
          `  Expected: ${expectedTarget}\n` +
          `  Skipping removal for safety.`
        );
        continue;
      }

      // 6. Rimuovi symlink
      try {
        fs.unlinkSync(symlinkPath);
        console.log(`✓ Removed symlink for section "${sectionId}": ${symlinkPath}`);
      } catch (error) {
        console.error(`✗ Failed to remove symlink for section "${sectionId}":`, error.message);
        throw error;
      }
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
