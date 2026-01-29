/**
 * PLUGIN: adminAccessControl
 *
 * Sistema di controllo accessi basato su ruoli per pagine e route.
 *
 * Features:
 * - Pattern matching: esatto, wildcard (*, **), regex
 * - Priorità automatica (esatto > regex > wildcard singolo > wildcard ricorsivo)
 * - Regole hardcoded (immutabili) e custom (modificabili via UI)
 * - Validazione completa (sintassi, campi obbligatori, ruoli, regex)
 * - UI admin per gestione regole
 * - Middleware globale per intercettare tutte le richieste
 */

const AccessManager = require('./lib/accessManager');
const RuleValidator = require('./lib/ruleValidator');
const path = require('path');
const loadJson5 = require('../../core/loadJson5');

// Carica configurazione principale per ottenere apiPrefix
const ital8Conf = loadJson5(path.join(__dirname, '../../ital8Config.json5'));

// Variabile di modulo per mantenere riferimenti
let accessManager = null;
let ruleValidator = null;
let pluginSys = null;
let pathPluginFolder = null;

module.exports = {
  /**
   * Caricamento plugin
   */
  async loadPlugin(pluginSysParam, pathPluginFolderParam) {
    pluginSys = pluginSysParam;
    pathPluginFolder = pathPluginFolderParam;

    console.log('[adminAccessControl] Loading plugin...');

    // Inizializza AccessManager
    accessManager = new AccessManager(pluginSys, pathPluginFolder);

    // Inizializza RuleValidator
    ruleValidator = new RuleValidator(pluginSys, ital8Conf);

    // Valida configurazione al boot
    const configPath = path.join(pathPluginFolder, 'accessControl.json5');
    const config = loadJson5(configPath);
    const validation = ruleValidator.validateConfig(config, false);

    if (!validation.valid) {
      console.error('[adminAccessControl] Configuration validation FAILED:');
      validation.errors.forEach(err => console.error(`  - ${err}`));

      // Errore fatale se validazione fallisce
      throw new Error(`adminAccessControl: Configuration validation failed. See errors above.`);
    }

    console.log('[adminAccessControl] ✓ Configuration validated successfully');
    console.log('[adminAccessControl] ✓ Plugin loaded');
  },

  /**
   * Installazione plugin (prima volta)
   */
  async installPlugin(pluginSys, pathPluginFolder) {
    console.log('[adminAccessControl] Installing plugin...');

    // Nessuna operazione speciale necessaria
    // La configurazione accessControl.json5 è già presente
    // Le regole hardcoded sono già definite

    console.log('[adminAccessControl] ✓ Plugin installed successfully');
  },

  /**
   * Middleware da aggiungere all'applicazione Koa
   * IMPORTANTE: Questo middleware deve essere caricato DOPO session ma PRIMA del router
   * @param {object} app - Koa application instance
   * @returns {array} - Array di middleware functions
   */
  getMiddlewareToAdd(app) {
    const middlewareArray = [];

    // Aggiungi il middleware di access control
    // accessManager è già inizializzato in loadPlugin() che viene chiamato prima
    middlewareArray.push(accessManager.createMiddleware());

    return middlewareArray;
  },

  /**
   * API Endpoints per gestione regole
   */
  getRouteArray() {
    return [
      // GET /api/adminAccessControl/rules - Ottieni tutte le regole
      {
        method: 'GET',
        path: '/rules',
        access: {
          requiresAuth: true,
          allowedRoles: [0, 1] // Solo root e admin
        },
        handler: async (ctx) => {
          try {
            const rules = accessManager.getRulesForUI();
            ctx.body = {
              success: true,
              data: rules
            };
          } catch (err) {
            console.error('[adminAccessControl] Error getting rules', err);
            ctx.status = 500;
            ctx.body = {
              success: false,
              error: 'Failed to load rules'
            };
          }
        }
      },

      // GET /api/adminAccessControl/rules-json - Ottieni JSON5 completo come stringa
      {
        method: 'GET',
        path: '/rules-json',
        access: {
          requiresAuth: true,
          allowedRoles: [0, 1]
        },
        handler: async (ctx) => {
          try {
            const fs = require('fs');
            const configPath = path.join(pathPluginFolder, 'accessControl.json5');
            const jsonContent = fs.readFileSync(configPath, 'utf8');

            ctx.body = {
              success: true,
              data: jsonContent
            };
          } catch (err) {
            console.error('[adminAccessControl] Error reading JSON', err);
            ctx.status = 500;
            ctx.body = {
              success: false,
              error: 'Failed to read configuration file'
            };
          }
        }
      },

      // POST /api/adminAccessControl/rules - Salva regole modificate
      {
        method: 'POST',
        path: '/rules',
        access: {
          requiresAuth: true,
          allowedRoles: [0, 1]
        },
        handler: async (ctx) => {
          try {
            const { jsonContent } = ctx.request.body;

            if (!jsonContent) {
              ctx.status = 400;
              ctx.body = {
                success: false,
                error: 'Missing jsonContent in request body'
              };
              return;
            }

            // Carica regole hardcoded originali (immutabili)
            const configPath = path.join(pathPluginFolder, 'accessControl.json5');
            const originalConfig = loadJson5(configPath);
            const originalHardcoded = originalConfig.hardcodedRules;

            // Valida JSON da UI
            const validation = ruleValidator.validateFromUI(jsonContent, originalHardcoded);

            if (!validation.valid) {
              ctx.status = 400;
              ctx.body = {
                success: false,
                errors: validation.errors
              };
              return;
            }

            // Salva regole (passa la stringa JSON5 originale per preservare commenti e formattazione)
            const saveResult = accessManager.saveRules(jsonContent);

            if (!saveResult.success) {
              ctx.status = 500;
              ctx.body = {
                success: false,
                error: saveResult.error
              };
              return;
            }

            ctx.body = {
              success: true,
              message: 'Rules saved successfully'
            };
          } catch (err) {
            console.error('[adminAccessControl] Error saving rules', err);
            ctx.status = 500;
            ctx.body = {
              success: false,
              error: err.message
            };
          }
        }
      },

      // POST /api/adminAccessControl/test-access - Testa accesso per URL e ruolo
      {
        method: 'POST',
        path: '/test-access',
        access: {
          requiresAuth: true,
          allowedRoles: [0, 1]
        },
        handler: async (ctx) => {
          try {
            const { url, roleIds } = ctx.request.body;

            if (!url || !Array.isArray(roleIds)) {
              ctx.status = 400;
              ctx.body = {
                success: false,
                error: 'Missing url or roleIds in request body'
              };
              return;
            }

            // Simula utente con ruoli specificati
            const mockUser = { roleIds };

            // Testa accesso
            const accessResult = accessManager.checkAccess(url, mockUser);

            ctx.body = {
              success: true,
              data: accessResult
            };
          } catch (err) {
            console.error('[adminAccessControl] Error testing access', err);
            ctx.status = 500;
            ctx.body = {
              success: false,
              error: err.message
            };
          }
        }
      }
    ];
  },

  /**
   * Oggetti condivisi con template EJS
   * Espone helper per controllo accessi nei template
   */
  getObjectToShareToWebPages() {
    return {
      /**
       * Verifica accesso in template EJS
       * Uso: <% passData.accessControl.check({ requiresAuth: true, allowedRoles: [102, 104] }) %>
       * Se accesso negato, fa redirect automaticamente
       */
      check: (requirements, ctx) => {
        if (!accessManager) {
          console.error('[adminAccessControl] AccessManager not initialized');
          return;
        }
        accessManager.checkInTemplate(ctx, requirements);
      }
    };
  }
};
