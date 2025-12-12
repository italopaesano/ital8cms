const path = require('path');
const loadJson5 = require('../../loadJson5');

/**
 * ConfigManager - Gestisce la configurazione dell'admin system
 *
 * Responsabilità:
 * - Carica adminConfig.json5
 * - Valida la configurazione
 * - Fornisce accesso ai dati di configurazione
 */
class ConfigManager {
  constructor() {
    this.config = null;
    this.configPath = path.join(__dirname, '../adminConfig.json5');

    this.loadConfig();
    this.validateConfig();
  }

  /**
   * Carica adminConfig.json5
   */
  loadConfig() {
    try {
      this.config = loadJson5(this.configPath);
      console.log('✓ Admin config loaded');
    } catch (error) {
      throw new Error(`Failed to load admin config: ${error.message}`);
    }
  }

  /**
   * Valida la configurazione
   */
  validateConfig() {
    if (!this.config) {
      throw new Error('Admin config is null');
    }

    if (!this.config.sections) {
      throw new Error('Admin config missing "sections"');
    }

    if (!this.config.menuOrder) {
      throw new Error('Admin config missing "menuOrder"');
    }

    // Valida che ogni sezione in menuOrder esista in sections
    for (const sectionId of this.config.menuOrder) {
      if (!this.config.sections[sectionId]) {
        console.warn(`⚠️ Section "${sectionId}" in menuOrder does not exist in sections`);
      }
    }

    // Valida sezioni
    for (const [sectionId, sectionConfig] of Object.entries(this.config.sections)) {
      if (!sectionConfig.type) {
        throw new Error(`Section "${sectionId}" missing "type"`);
      }

      if (sectionConfig.type !== 'plugin' && sectionConfig.type !== 'hardcoded') {
        throw new Error(`Section "${sectionId}" has invalid type: ${sectionConfig.type}`);
      }

      if (sectionConfig.type === 'plugin' && !sectionConfig.plugin) {
        throw new Error(`Section "${sectionId}" is type "plugin" but missing "plugin" name`);
      }
    }

    console.log('✓ Admin config validated');
  }

  /**
   * Ottiene la configurazione completa
   * @returns {object}
   */
  getConfig() {
    return this.config;
  }

  /**
   * Ottiene una sezione specifica
   * @param {string} sectionId
   * @returns {object|null}
   */
  getSection(sectionId) {
    return this.config.sections[sectionId] || null;
  }

  /**
   * Ottiene tutte le sezioni
   * @returns {object}
   */
  getSections() {
    return this.config.sections;
  }

  /**
   * Ottiene l'ordine del menu
   * @returns {Array<string>}
   */
  getMenuOrder() {
    return this.config.menuOrder;
  }

  /**
   * Ottiene configurazione servizi
   * @returns {object}
   */
  getServices() {
    return this.config.services || {};
  }

  /**
   * Ottiene configurazione UI
   * @returns {object}
   */
  getUI() {
    return this.config.ui || {};
  }
}

module.exports = ConfigManager;
