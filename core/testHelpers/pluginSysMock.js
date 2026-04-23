/**
 * pluginSysMock.js
 *
 * Factory per creare un mock del PluginSys usabile nei test di plugin che
 * interagiscono con altri plugin (getSharedObject), hook di pagina, theme system.
 */

/**
 * Crea un mock del PluginSys.
 *
 * @param {Object} [options={}]
 * @param {Object} [options.sharedObjects={}] Mappa providerPluginName → oggetto (o funzione (callerName) → oggetto)
 * @param {Object} [options.plugins={}] Mappa pluginName → plugin object
 * @param {Object} [options.globalFunctions={}] Valore restituito da getGlobalFunctions()
 * @param {Object} [options.themeSys=null] Istanza/mock del themeSys restituito da getThemeSys()
 * @param {Object} [options.adminSystem=null] Istanza/mock dell'adminSystem
 * @param {Object} [options.hookReturns={}] Mappa section → stringa (o funzione (passData) → stringa)
 *   restituita da hookPage(section, passData)
 * @returns {Object} Mock del PluginSys con tutti i metodi come jest.fn()
 */
function createPluginSysMock(options = {}) {
  const sharedObjects = options.sharedObjects || {};
  const plugins = options.plugins || {};
  const globalFunctions = options.globalFunctions || {};
  const themeSys = options.themeSys !== undefined ? options.themeSys : null;
  const adminSystem = options.adminSystem !== undefined ? options.adminSystem : null;
  const hookReturns = options.hookReturns || {};

  return {
    getSharedObject: jest.fn((providerName, callerName) => {
      const value = sharedObjects[providerName];
      if (value === undefined) return null;
      if (typeof value === 'function') return value(callerName);
      return value;
    }),

    hookPage: jest.fn(async (section, passData) => {
      const value = hookReturns[section];
      if (value === undefined) return '';
      if (typeof value === 'function') return await value(passData);
      return value;
    }),

    getThemeSys: jest.fn(() => themeSys),

    getAdminSystem: jest.fn(() => adminSystem),
    setAdminSystem: jest.fn(),

    getAllPlugins: jest.fn(() => Object.values(plugins)),
    getPlugin: jest.fn((pluginName) => plugins[pluginName] || null),

    getGlobalFunctions: jest.fn(() => globalFunctions)
  };
}

module.exports = { createPluginSysMock };
