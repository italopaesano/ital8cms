/**
 * ============================================================================
 * THEMES MANAGEMENT MODULE
 * Modulo per la gestione dei temi nel pannello di amministrazione
 * ============================================================================
 *
 * INDICE FUNZIONI:
 *
 * 1. getThemesList()
 *    - Ritorna la lista di tutti i temi disponibili nella cartella /themes
 *    - Include validazione struttura, dipendenze, status attivazione
 *    - Utilizza themeSys.getAvailableThemes() per dati base
 *
 * 2. getThemeDetails(themeName)
 *    - Ritorna i dettagli completi di un tema specifico
 *    - Include: config, description, file, validazione, dipendenze, README
 *    - Verifica esistenza e validità del tema
 *
 * 3. setActiveTheme(themeName, themeType)
 *    - Attiva un tema per il sito pubblico o il pannello admin
 *    - themeType: 'public' (activeTheme) o 'admin' (adminActiveTheme)
 *    - Valida tema prima di attivare
 *    - Modifica ital8Config.json con salvataggio atomico
 *    - Ritorna necessità di riavvio server
 *
 * 4. getRoutes()
 *    - Genera array di route Koa per l'API
 *    - Endpoint disponibili:
 *      GET  /api/admin/themes          -> Lista temi
 *      GET  /api/admin/themes/:name    -> Dettagli tema
 *      POST /api/admin/setTheme        -> Attiva tema
 *
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../core/loadJson5');
const adminMain = require('./main');

/**
 * Ritorna la lista di tutti i temi disponibili
 * @param {object} themeSys - Istanza del sistema temi
 * @returns {Array} Array di oggetti tema con dettagli completi
 */
function getThemesList(themeSys) {
    try {
        // Usa themeSys per ottenere lista base con validazione
        const themes = themeSys.getAvailableThemes();

        // Arricchisci ogni tema con informazioni aggiuntive
        const enrichedThemes = themes.map(theme => {
            const themePath = path.join(__dirname, '../../themes', theme.name);

            // Leggi file di configurazione
            const configPath = path.join(themePath, 'themeConfig.json');
            const descriptionPath = path.join(themePath, 'themeDescription.json');

            let config = {};
            let description = {};

            try {
                if (fs.existsSync(configPath)) {
                    config = loadJson5(configPath);
                }
                if (fs.existsSync(descriptionPath)) {
                    description = loadJson5(descriptionPath);
                }
            } catch (error) {
                console.error(`[themesManagment] Errore lettura file tema ${theme.name}:`, error.message);
            }

            // Conta file views e templates
            const viewsPath = path.join(themePath, 'views');
            const templatesPath = path.join(themePath, 'templates');

            let viewsCount = 0;
            let templatesCount = 0;

            if (fs.existsSync(viewsPath)) {
                viewsCount = fs.readdirSync(viewsPath).filter(f => f.endsWith('.ejs')).length;
            }
            if (fs.existsSync(templatesPath)) {
                templatesCount = fs.readdirSync(templatesPath).filter(f => f.endsWith('.ejs')).length;
            }

            // Verifica dipendenze
            let dependenciesStatus = { satisfied: true, errors: [] };
            if (themeSys.pluginSys) {
                dependenciesStatus = themeSys.checkDependencies(theme.name);
            }

            return {
                name: theme.name,
                description: description,
                config: config,
                valid: theme.valid,
                validationError: theme.error,
                isActivePublic: theme.isActive,
                isActiveAdmin: theme.isAdminActive,
                filesCount: {
                    views: viewsCount,
                    templates: templatesCount
                },
                dependencies: {
                    plugins: config.pluginDependency || {},
                    nodeModules: config.nodeModuleDependency || {},
                    satisfied: dependenciesStatus.satisfied,
                    errors: dependenciesStatus.errors
                },
                path: themePath
            };
        });

        return enrichedThemes;

    } catch (error) {
        console.error('[themesManagment] Errore in getThemesList:', error);
        return [];
    }
}

/**
 * Ritorna i dettagli completi di un tema specifico
 * @param {string} themeName - Nome del tema
 * @param {object} themeSys - Istanza del sistema temi
 * @returns {object} Oggetto con dettagli tema o errore
 */
function getThemeDetails(themeName, themeSys) {
    try {
        const themePath = path.join(__dirname, '../../themes', themeName);

        // Verifica esistenza
        if (!fs.existsSync(themePath)) {
            return {
                success: false,
                error: `Il tema "${themeName}" non esiste`
            };
        }

        // Valida tema
        const validation = themeSys.validateTheme(themeName);

        // Leggi file di configurazione
        const configPath = path.join(themePath, 'themeConfig.json');
        const descriptionPath = path.join(themePath, 'themeDescription.json');
        const readmePath = path.join(themePath, 'README.md');

        let config = {};
        let description = {};
        let readme = '';

        if (fs.existsSync(configPath)) {
            config = loadJson5(configPath);
        }
        if (fs.existsSync(descriptionPath)) {
            description = loadJson5(descriptionPath);
        }
        if (fs.existsSync(readmePath)) {
            readme = fs.readFileSync(readmePath, 'utf8');
        }

        // Leggi file views
        const viewsPath = path.join(themePath, 'views');
        let viewFiles = [];
        if (fs.existsSync(viewsPath)) {
            viewFiles = fs.readdirSync(viewsPath).filter(f => f.endsWith('.ejs'));
        }

        // Leggi file templates
        const templatesPath = path.join(themePath, 'templates');
        let templateFiles = [];
        if (fs.existsSync(templatesPath)) {
            templateFiles = fs.readdirSync(templatesPath).filter(f => f.endsWith('.ejs'));
        }

        // Leggi file themeResources
        const resourcesPath = path.join(themePath, 'themeResources');
        let resourceFiles = [];
        if (fs.existsSync(resourcesPath)) {
            resourceFiles = getAllFiles(resourcesPath, themePath);
        }

        // Leggi customizzazioni plugin
        const pluginCustomPath = path.join(themePath, 'pluginsEndpointsMarkup');
        let pluginCustomizations = [];
        if (fs.existsSync(pluginCustomPath)) {
            pluginCustomizations = themeSys.getCustomizedPlugins(false); // public theme
        }

        // Verifica dipendenze
        let dependenciesStatus = { satisfied: true, errors: [] };
        if (themeSys.pluginSys) {
            dependenciesStatus = themeSys.checkDependencies(themeName);
        }

        // Leggi configurazione corrente
        const ital8Config = loadJson5(path.join(__dirname, '../../ital8Config.json'));

        return {
            success: true,
            theme: {
                name: themeName,
                description: description,
                config: config,
                validation: {
                    valid: validation.valid,
                    error: validation.error,
                    hasViews: fs.existsSync(viewsPath),
                    hasConfig: fs.existsSync(configPath),
                    hasDescription: fs.existsSync(descriptionPath)
                },
                status: {
                    isActivePublic: ital8Config.activeTheme === themeName,
                    isActiveAdmin: ital8Config.adminActiveTheme === themeName
                },
                dependencies: {
                    plugins: config.pluginDependency || {},
                    nodeModules: config.nodeModuleDependency || {},
                    satisfied: dependenciesStatus.satisfied,
                    errors: dependenciesStatus.errors
                },
                files: {
                    views: viewFiles,
                    templates: templateFiles,
                    resources: resourceFiles,
                    pluginCustomizations: pluginCustomizations
                },
                readme: readme,
                path: themePath
            }
        };

    } catch (error) {
        console.error('[themesManagment] Errore in getThemeDetails:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Helper: ricorsivamente trova tutti i file in una directory
 */
function getAllFiles(dirPath, basePath) {
    let files = [];
    const items = fs.readdirSync(dirPath);

    items.forEach(item => {
        const itemPath = path.join(dirPath, item);
        const stat = fs.statSync(itemPath);

        if (stat.isDirectory()) {
            files = files.concat(getAllFiles(itemPath, basePath));
        } else {
            // Rimuovi basePath per path relativi
            const relativePath = itemPath.replace(basePath + path.sep, '');
            files.push(relativePath);
        }
    });

    return files;
}

/**
 * Attiva un tema per il sito pubblico o pannello admin
 * @param {string} themeName - Nome del tema da attivare
 * @param {string} themeType - 'public' o 'admin'
 * @param {object} themeSys - Istanza del sistema temi
 * @returns {object} Risultato operazione
 */
function setActiveTheme(themeName, themeType, themeSys) {
    try {
        // Validazione parametri
        if (!themeName || !themeType) {
            return {
                success: false,
                error: 'Parametri mancanti: themeName e themeType sono obbligatori'
            };
        }

        if (themeType !== 'public' && themeType !== 'admin') {
            return {
                success: false,
                error: 'themeType deve essere "public" o "admin"'
            };
        }

        // Verifica esistenza tema
        const themePath = path.join(__dirname, '../../themes', themeName);
        if (!fs.existsSync(themePath)) {
            return {
                success: false,
                error: `Il tema "${themeName}" non esiste`
            };
        }

        // Valida struttura tema
        const validation = themeSys.validateTheme(themeName);
        if (!validation.valid) {
            return {
                success: false,
                error: `Tema non valido: ${validation.error}`
            };
        }

        // Verifica dipendenze (warning ma non blocca)
        let dependenciesWarning = null;
        if (themeSys.pluginSys) {
            const depsCheck = themeSys.checkDependencies(themeName);
            if (!depsCheck.satisfied) {
                dependenciesWarning = depsCheck.errors.join(', ');
                console.warn(`[themesManagment] Dipendenze non soddisfatte per ${themeName}:`, dependenciesWarning);
            }
        }

        // Carica configurazione corrente
        const configPath = path.join(__dirname, '../../ital8Config.json');
        const config = loadJson5(configPath);

        // Modifica configurazione
        const oldTheme = themeType === 'public' ? config.activeTheme : config.adminActiveTheme;

        if (themeType === 'public') {
            config.activeTheme = themeName;
        } else {
            config.adminActiveTheme = themeName;
        }

        // Salvataggio atomico
        const tempPath = configPath + '.tmp';
        fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf8');
        fs.renameSync(tempPath, configPath);

        const typeLabel = themeType === 'public' ? 'sito pubblico' : 'pannello admin';

        return {
            success: true,
            message: `Tema "${themeName}" attivato con successo per ${typeLabel}`,
            previousTheme: oldTheme,
            needsRestart: true,
            dependenciesWarning: dependenciesWarning
        };

    } catch (error) {
        console.error('[themesManagment] Errore in setActiveTheme:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Genera le route API per la gestione dei temi
 * @returns {Array} Array di oggetti route per Koa
 */
function getRoutes() {
    return [
        // GET /api/admin/themes - Lista tutti i temi
        {
            method: 'GET',
            path: '/themes',
            handler: async (ctx) => {
                try {
                    // Ottieni themeSys tramite pluginSys
                    const pluginSys = adminMain.getPluginSys();
                    if (!pluginSys) {
                        throw new Error('pluginSys non disponibile');
                    }
                    const themeSys = pluginSys.getThemeSys();
                    if (!themeSys) {
                        throw new Error('themeSys non disponibile');
                    }

                    const themes = getThemesList(themeSys);

                    ctx.body = {
                        success: true,
                        themes: themes,
                        count: themes.length
                    };
                } catch (error) {
                    console.error('[themesManagment] Errore GET /themes:', error);
                    ctx.status = 500;
                    ctx.body = {
                        success: false,
                        error: error.message
                    };
                }
            }
        },

        // GET /api/admin/themes/:name - Dettagli di un tema
        {
            method: 'GET',
            path: '/themes/:name',
            handler: async (ctx) => {
                try {
                    const themeName = ctx.params.name;

                    // Ottieni themeSys tramite pluginSys
                    const pluginSys = adminMain.getPluginSys();
                    if (!pluginSys) {
                        throw new Error('pluginSys non disponibile');
                    }
                    const themeSys = pluginSys.getThemeSys();
                    if (!themeSys) {
                        throw new Error('themeSys non disponibile');
                    }

                    const result = getThemeDetails(themeName, themeSys);

                    if (result.success) {
                        ctx.body = result;
                    } else {
                        ctx.status = 404;
                        ctx.body = result;
                    }
                } catch (error) {
                    console.error('[themesManagment] Errore GET /themes/:name:', error);
                    ctx.status = 500;
                    ctx.body = {
                        success: false,
                        error: error.message
                    };
                }
            }
        },

        // POST /api/admin/setTheme - Attiva un tema
        {
            method: 'POST',
            path: '/setTheme',
            handler: async (ctx) => {
                try {
                    const { themeName, themeType } = ctx.request.body;

                    // Ottieni themeSys tramite pluginSys
                    const pluginSys = adminMain.getPluginSys();
                    if (!pluginSys) {
                        throw new Error('pluginSys non disponibile');
                    }
                    const themeSys = pluginSys.getThemeSys();
                    if (!themeSys) {
                        throw new Error('themeSys non disponibile');
                    }

                    const result = setActiveTheme(themeName, themeType, themeSys);

                    if (result.success) {
                        ctx.body = result;
                    } else {
                        ctx.status = 400;
                        ctx.body = result;
                    }
                } catch (error) {
                    console.error('[themesManagment] Errore POST /setTheme:', error);
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
    getThemesList,
    getThemeDetails,
    setActiveTheme,
    getRoutes
};
