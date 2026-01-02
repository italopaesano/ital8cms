const path = require('path');
const loadJson5 = require('../../core/loadJson5');
const Handlebars = require('handlebars');

module.exports = {
  config: null,
  pluginSys: null,
  pathPluginFolder: null,

  async loadPlugin(pluginSys, pathPluginFolder) {
    this.pluginSys = pluginSys;
    this.pathPluginFolder = pathPluginFolder;

    const configPath = path.join(pathPluginFolder, 'pluginConfig.json5');
    this.config = loadJson5(configPath).custom;

    console.log('[simpleI18n] Plugin loaded - Default language: ' + this.config.defaultLang);
    console.log('[simpleI18n] Supported languages: ' + this.config.supportedLangs.join(', '));
  },

  async upgradePlugin(pluginSys, pathPluginFolder, oldVersion, newVersion) {
    console.log('[simpleI18n] Upgrading from ' + oldVersion + ' to ' + newVersion);

    // Future upgrade logic can be added here
    // For example:
    // - Migrate old configuration formats
    // - Update translation files
    // - Perform data migrations

    console.log('[simpleI18n] Upgrade completed successfully');
  },

  getMiddlewareToAdd(app) {
    const middlewareArray = [];

    // Language detection middleware
    middlewareArray.push(
      async (ctx, next) => {
          let detectedLang = null;
          let originalPath = ctx.path;

          if (this.config.enableUrlPrefix) {
            const urlMatch = ctx.path.match(/^\/([a-z]{2})(\/|$)/i);
            if (urlMatch) {
              const langCode = urlMatch[1].toLowerCase();

              if (this.config.supportedLangs.includes(langCode)) {
                detectedLang = langCode;

                if (this.config.stripLangFromUrl) {
                  ctx.path = ctx.path.replace(/^\/[a-z]{2}(\/|$)/i, '/');
                  if (ctx.path === '') {
                    ctx.path = '/';
                  }
                }
              }
            }
          }

          if (!detectedLang && this.config.enableBrowserDetection) {
            const browserLang = ctx.acceptsLanguages(...this.config.supportedLangs);
            if (browserLang) {
              detectedLang = browserLang;
            }
          }

          if (!detectedLang) {
            detectedLang = this.config.defaultLang;
          }

          ctx.state.lang = detectedLang;
          ctx.state.originalPath = originalPath;

          if (this.config.debugMode) {
            console.log('[simpleI18n] ' + originalPath + ' → lang: ' + detectedLang + ', path: ' + ctx.path);
          }

          await next();
      }
    );

    return middlewareArray;
  },

  getObjectToShareToOthersPlugin(forPlugin, pluginSys, pathPluginFolder) {
    return {
      __: this.translate.bind(this),

      getCurrentLang: (ctx) => {
        return ctx?.state?.lang || this.config.defaultLang;
      },

      getSupportedLangs: () => {
        return [...this.config.supportedLangs];
      },

      getConfig: () => {
        return { ...this.config };
      }
    };
  },

  translate(translationObj, ctx = null) {
    const currentLang = ctx?.state?.lang || this.config.defaultLang;

    let translation = translationObj[currentLang];

    if (!translation) {
      translation = translationObj[this.config.defaultLang];
    }

    if (!translation) {
      for (const lang of this.config.supportedLangs) {
        if (translationObj[lang]) {
          translation = translationObj[lang];
          break;
        }
      }
    }

    if (!translation) {
      return '[' + (translationObj.key || 'missing-translation') + ']';
    }

    if (translationObj.var && typeof translationObj.var === 'object') {
      try {
        const template = Handlebars.compile(translation);
        return template(translationObj.var);
      } catch (error) {
        console.error('[simpleI18n] Handlebars error for key "' + translationObj.key + '":', error);
        return translation;
      }
    }

    return translation;
  }
};
