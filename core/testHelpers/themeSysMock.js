/**
 * themeSysMock.js
 *
 * Factory per creare un mock del ThemeSys (o del suo wrapper bound a passData)
 * usabile nei test di template rendering, plugin pages e admin pages.
 */

/**
 * Crea un mock del ThemeSys wrapper.
 *
 * @param {Object} [options={}]
 * @param {string} [options.publicTheme='defaultTheme']
 * @param {string} [options.adminTheme='defaultAdminTheme']
 * @param {Object} [options.customizations={}] Valori restituiti dagli inject*()
 *   - css, js, htmlBefore, htmlAfter
 * @param {Function} [options.getThemePartPath] Override per generare path dei partial
 * @param {Function} [options.getThemeResourceUrl] Override per generare URL delle risorse
 * @returns {Object} Mock con tutti i metodi del themeSys wrapper
 */
function createThemeSysMock(options = {}) {
  const publicTheme = options.publicTheme || 'defaultTheme';
  const adminTheme = options.adminTheme || 'defaultAdminTheme';
  const customizations = options.customizations || {};

  const defaultGetThemePartPath = (fileName) => `/themes/${publicTheme}/views/${fileName}`;
  const defaultGetThemeResourceUrl = (resourcePath) => `/public-theme-resources/${resourcePath}`;

  return {
    publicTheme,
    adminTheme,

    getThemePartPath: jest.fn(options.getThemePartPath || defaultGetThemePartPath),
    getThemeResourceUrl: jest.fn(options.getThemeResourceUrl || defaultGetThemeResourceUrl),

    injectPluginCss: jest.fn(() => customizations.css || ''),
    injectPluginJs: jest.fn(() => customizations.js || ''),
    injectPluginHtmlBefore: jest.fn(() => customizations.htmlBefore || ''),
    injectPluginHtmlAfter: jest.fn(() => customizations.htmlAfter || ''),

    getPluginCustomCss: jest.fn(() => customizations.css || ''),
    getPluginCustomJs: jest.fn(() => customizations.js || ''),
    getPluginCustomHtml: jest.fn((position) => {
      if (position === 'before') return customizations.htmlBefore || '';
      if (position === 'after') return customizations.htmlAfter || '';
      return '';
    }),

    resolvePluginTemplatePath: jest.fn((pluginName, pageName, defaultPath) => defaultPath),

    extractPluginContext: jest.fn((filePath) => {
      if (!filePath) return { pluginName: null, pageName: null };
      const match = filePath.match(
        /\/(?:plugins|pluginPages)\/([^/]+)\/(?:webPages\/)?([^/]+)\.ejs$/
      );
      if (match) return { pluginName: match[1], pageName: match[2] };
      return { pluginName: null, pageName: null };
    })
  };
}

module.exports = { createThemeSysMock };
