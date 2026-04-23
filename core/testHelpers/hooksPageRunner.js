/**
 * hooksPageRunner.js
 *
 * Esegue getHooksPage() di un plugin per una sezione specifica e restituisce
 * il contenuto iniettato.
 */

/**
 * Esegue il page hook di un plugin.
 *
 * @param {Object} plugin - Plugin object (module.exports del plugin)
 * @param {string} section - Sezione della pagina ('head', 'header', 'body', 'footer', 'script')
 * @param {Object} [passData={}] - passData come passato dai template
 * @param {Object} [pluginSys=null] - Istanza PluginSys (o mock)
 * @param {string} [pathPluginFolder=null] - Path della cartella del plugin
 * @returns {Promise<string>} Contenuto HTML restituito dal hook, oppure '' se non implementato
 */
async function runPageHook(plugin, section, passData, pluginSys, pathPluginFolder) {
  if (!plugin || typeof plugin.getHooksPage !== 'function') {
    return '';
  }
  const result = await plugin.getHooksPage(
    section,
    passData || {},
    pluginSys || null,
    pathPluginFolder || null
  );
  return result || '';
}

module.exports = { runPageHook };
