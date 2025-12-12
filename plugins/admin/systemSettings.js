/**
 * ============================================================================
 * SYSTEM SETTINGS MODULE
 * Modulo per la gestione delle impostazioni di sistema
 * ============================================================================
 *
 * INDICE FUNZIONI:
 *
 * 1. getSystemConfig()
 *    - Ritorna il contenuto completo di ital8Config.json5
 *    - Supporta JSON5 (commenti e trailing commas)
 *
 * 2. updateSystemConfig(newConfig)
 *    - Aggiorna ital8Config.json5 con nuova configurazione
 *    - Valida campi obbligatori e tipi
 *    - Salvataggio atomico (.tmp + rename)
 *    - Avvisa se activeTheme/adminActiveTheme vengono modificati
 *
 * 3. validateSystemConfig(config)
 *    - Valida la struttura della configurazione
 *    - Verifica campi obbligatori (TUTTI i campi attuali sono obbligatori)
 *    - Verifica tipi dei valori
 *
 * 4. getRoutes()
 *    - Genera array di route Koa per l'API
 *    - Endpoint disponibili:
 *      GET  /api/admin/systemSettings/config    -> Leggi configurazione
 *      POST /api/admin/systemSettings/config    -> Aggiorna configurazione
 *
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../core/loadJson5');

/**
 * Ritorna la configurazione di sistema completa
 * @returns {object} Configurazione da ital8Config.json5
 */
function getSystemConfig() {
    try {
        const configPath = path.join(__dirname, '../../ital8Config.json5');
        const config = loadJson5(configPath);

        return {
            success: true,
            config: config,
            path: configPath
        };
    } catch (error) {
        console.error('[systemSettings] Errore in getSystemConfig:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Valida la configurazione di sistema
 * @param {object} config - Configurazione da validare
 * @returns {object} - { valid: boolean, errors: Array<string> }
 */
function validateSystemConfig(config) {
    const errors = [];

    // TUTTI i campi attualmente esistenti sono obbligatori
    const requiredFields = [
        'apiPrefix',
        'adminPrefix',
        'enableAdmin',
        'viewsPrefix',
        'baseThemePath',
        'activeTheme',
        'adminActiveTheme',
        'wwwPath',
        'debugMode',
        'httpPort',
        'useHttps',
        'httpsPort',
        'AutoRedirectHttpPortToHttpsPort'
    ];

    // Verifica presenza campi obbligatori
    requiredFields.forEach(field => {
        if (config[field] === undefined || config[field] === null) {
            errors.push(`Campo obbligatorio mancante: "${field}"`);
        }
    });

    // Validazione tipi specifici
    if (config.apiPrefix !== undefined) {
        if (typeof config.apiPrefix !== 'string' || config.apiPrefix.length === 0) {
            errors.push('apiPrefix deve essere una stringa non vuota');
        } else if (!/^[a-zA-Z0-9_-]+$/.test(config.apiPrefix)) {
            errors.push('apiPrefix può contenere solo lettere, numeri, underscore e trattini');
        }
    }

    if (config.adminPrefix !== undefined) {
        if (typeof config.adminPrefix !== 'string' || config.adminPrefix.length === 0) {
            errors.push('adminPrefix deve essere una stringa non vuota');
        } else if (!/^[a-zA-Z0-9_-]+$/.test(config.adminPrefix)) {
            errors.push('adminPrefix può contenere solo lettere, numeri, underscore e trattini');
        }
    }

    if (config.viewsPrefix !== undefined) {
        if (typeof config.viewsPrefix !== 'string' || config.viewsPrefix.length === 0) {
            errors.push('viewsPrefix deve essere una stringa non vuota');
        }
    }

    if (config.baseThemePath !== undefined) {
        if (typeof config.baseThemePath !== 'string' || config.baseThemePath.length === 0) {
            errors.push('baseThemePath deve essere una stringa non vuota');
        }
    }

    if (config.activeTheme !== undefined) {
        if (typeof config.activeTheme !== 'string' || config.activeTheme.length === 0) {
            errors.push('activeTheme deve essere una stringa non vuota');
        }
    }

    if (config.adminActiveTheme !== undefined) {
        if (typeof config.adminActiveTheme !== 'string' || config.adminActiveTheme.length === 0) {
            errors.push('adminActiveTheme deve essere una stringa non vuota');
        }
    }

    if (config.wwwPath !== undefined) {
        if (typeof config.wwwPath !== 'string' || config.wwwPath.length === 0) {
            errors.push('wwwPath deve essere una stringa non vuota');
        }
    }

    if (config.httpPort !== undefined) {
        if (typeof config.httpPort !== 'number' || config.httpPort < 1 || config.httpPort > 65535) {
            errors.push('httpPort deve essere un numero tra 1 e 65535');
        }
    }

    if (config.httpsPort !== undefined) {
        // httpsPort può essere stringa vuota o numero
        if (config.httpsPort !== '' && (typeof config.httpsPort !== 'number' || config.httpsPort < 1 || config.httpsPort > 65535)) {
            errors.push('httpsPort deve essere un numero tra 1 e 65535 o stringa vuota');
        }
    }

    if (config.debugMode !== undefined) {
        if (typeof config.debugMode !== 'number' || (config.debugMode !== 0 && config.debugMode !== 1)) {
            errors.push('debugMode deve essere 0 o 1');
        }
    }

    if (config.enableAdmin !== undefined) {
        if (typeof config.enableAdmin !== 'boolean') {
            errors.push('enableAdmin deve essere true o false');
        }
    }

    if (config.useHttps !== undefined) {
        if (typeof config.useHttps !== 'boolean') {
            errors.push('useHttps deve essere true o false');
        }
    }

    if (config.AutoRedirectHttpPortToHttpsPort !== undefined) {
        if (typeof config.AutoRedirectHttpPortToHttpsPort !== 'boolean') {
            errors.push('AutoRedirectHttpPortToHttpsPort deve essere true o false');
        }
    }

    return {
        valid: errors.length === 0,
        errors: errors
    };
}

/**
 * Aggiorna la configurazione di sistema
 * @param {object} newConfig - Nuova configurazione
 * @returns {object} Risultato operazione
 */
function updateSystemConfig(newConfig) {
    try {
        // Validazione configurazione
        const validation = validateSystemConfig(newConfig);
        if (!validation.valid) {
            return {
                success: false,
                error: 'Validazione fallita',
                validationErrors: validation.errors
            };
        }

        const configPath = path.join(__dirname, '../../ital8Config.json5');

        // Leggi configurazione corrente per confronto
        const currentConfig = loadJson5(configPath);

        // Avvisi per modifiche ai temi (dovrebbero essere gestiti in themesManagment)
        const warnings = [];
        if (newConfig.activeTheme !== currentConfig.activeTheme) {
            warnings.push('Hai modificato activeTheme. Considera di usare la sezione Gestione Temi.');
        }
        if (newConfig.adminActiveTheme !== currentConfig.adminActiveTheme) {
            warnings.push('Hai modificato adminActiveTheme. Considera di usare la sezione Gestione Temi.');
        }

        // Salvataggio atomico
        const tempPath = configPath + '.tmp';

        // Mantieni il commento JSON5 nella prima riga
        const configContent = '// This file follows the JSON5 standard - comments and trailing commas are supported\n' +
                             JSON.stringify(newConfig, null, 2);

        fs.writeFileSync(tempPath, configContent, 'utf8');
        fs.renameSync(tempPath, configPath);

        return {
            success: true,
            message: 'Configurazione aggiornata con successo. Riavvia il server per applicare le modifiche.',
            warnings: warnings.length > 0 ? warnings : null,
            needsRestart: true
        };

    } catch (error) {
        console.error('[systemSettings] Errore in updateSystemConfig:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Genera le route API per la gestione delle impostazioni di sistema
 * @returns {Array} Array di oggetti route per Koa
 */
function getRoutes() {
    return [
        // GET /api/admin/systemSettings/config - Leggi configurazione
        {
            method: 'GET',
            path: '/systemSettings/config',
            handler: async (ctx) => {
                try {
                    const result = getSystemConfig();

                    if (result.success) {
                        ctx.body = result;
                    } else {
                        ctx.status = 500;
                        ctx.body = result;
                    }
                } catch (error) {
                    console.error('[systemSettings] Errore GET /config:', error);
                    ctx.status = 500;
                    ctx.body = {
                        success: false,
                        error: error.message
                    };
                }
            }
        },

        // POST /api/admin/systemSettings/config - Aggiorna configurazione
        {
            method: 'POST',
            path: '/systemSettings/config',
            handler: async (ctx) => {
                try {
                    const { config } = ctx.request.body;

                    if (!config) {
                        ctx.status = 400;
                        ctx.body = {
                            success: false,
                            error: 'Configurazione mancante nel body della richiesta'
                        };
                        return;
                    }

                    const result = updateSystemConfig(config);

                    if (result.success) {
                        ctx.body = result;
                    } else {
                        ctx.status = 400;
                        ctx.body = result;
                    }
                } catch (error) {
                    console.error('[systemSettings] Errore POST /config:', error);
                    ctx.status = 500;
                    ctx.body = {
                        success: false,
                        error: error.message
                    };
                }
            }
        }
    ];
}

module.exports = {
    getSystemConfig,
    updateSystemConfig,
    validateSystemConfig,
    getRoutes
};
