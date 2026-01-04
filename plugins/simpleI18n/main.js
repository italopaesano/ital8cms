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

    // IMPORTANTE: Salva this.config in closure per evitare problemi di binding
    const config = this.config;

    // Language detection middleware
    middlewareArray.push(
      async (ctx, next) => {
          let detectedLang = null;

          // Priority 1: Query string (?lang=en)
          if (config.enableQueryString) {
            const queryLang = ctx.query[config.queryStringParam];
            if (queryLang && config.supportedLangs.includes(queryLang.toLowerCase())) {
              detectedLang = queryLang.toLowerCase();
            }
          }

          // Priority 2: Browser detection (Accept-Language header)
          if (!detectedLang && config.enableBrowserDetection) {
            const browserLang = ctx.acceptsLanguages(...config.supportedLangs);
            if (browserLang) {
              detectedLang = browserLang;
            }
          }

          // Priority 3: Default language
          if (!detectedLang) {
            detectedLang = config.defaultLang;
          }

          // Save detected language in context
          ctx.state.lang = detectedLang;

          if (config.debugMode) {
            console.log('[simpleI18n] ' + ctx.path + ' → lang: ' + detectedLang + ' (from: ' +
              (ctx.query[config.queryStringParam] ? 'query' : 'browser/default') + ')');
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

  getObjectToShareToWebPages() {
    // Condivide funzioni con i template EJS (sintassi locale)
    // Disponibile come passData.plugin.simpleI18n.{function}(...)
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

  getGlobalFunctionsForTemplates() {
    // Esporta SOLO le funzioni destinate all'uso globale nei template
    // Queste funzioni devono essere autorizzate in ital8Config.json5 (globalFunctionsWhitelist)
    // Disponibile come __(...) (sintassi globale) nei template EJS
    return {
      __: this.translate.bind(this)
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
