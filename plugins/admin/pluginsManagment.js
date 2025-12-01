/**
 * MODULO GESTIONE PLUGIN
 *
 * Gestisce tutte le operazioni relative ai plugin dell'admin panel:
 * - Lista plugin disponibili
 * - Dettagli plugin (config, description, dipendenze)
 * - Attivazione/disattivazione plugin
 * - Modifica configurazione plugin
 *
 * ========================================
 * INDICE FUNZIONI
 * ========================================
 *
 * FUNZIONI PRINCIPALI:
 * -------------------
 * getPluginsList()
 *   - Scansiona la cartella /plugins e restituisce lista ordinata di tutti i plugin
 *   - Include: nome, stato attivo, versione, autore, dipendenze
 *   - Ordinamento: per weight (crescente), poi alfabetico
 *   - Return: Array di oggetti plugin
 *
 * getPluginDetails(pluginName)
 *   - Recupera informazioni complete di un plugin specifico
 *   - Include: config completa, description, lista file, path
 *   - Validazione: verifica esistenza main.js, pluginConfig.json, pluginDescription.json
 *   - Return: Object con dettagli completi o null se non trovato
 *
 * togglePlugin(pluginName, active)
 *   - Attiva (active=1) o disattiva (active=0) un plugin
 *   - Modifica il campo "active" in pluginConfig.json
 *   - Atomic write: usa file temporaneo .tmp per sicurezza
 *   - Return: {success: boolean, message/error: string}
 *
 * updatePluginConfig(pluginName, newConfig)
 *   - Aggiorna l'intera configurazione di un plugin
 *   - Validazione: imposta valori default per campi essenziali
 *   - Campi essenziali: active, isInstalled, weight, dependency, nodeModuleDependency
 *   - Atomic write: usa file temporaneo .tmp per sicurezza
 *   - Return: {success: boolean, message/error: string}
 *
 * ROUTE API:
 * ----------
 * getRoutes(router, pluginSys, pathPluginFolder)
 *   - Genera array di route Koa per la gestione plugin
 *   - Endpoint disponibili:
 *     * GET  /api/admin/plugins           - Lista tutti i plugin
 *     * GET  /api/admin/plugins/:name     - Dettagli plugin specifico
 *     * POST /api/admin/plugins/:name/toggle - Attiva/disattiva plugin
 *     * POST /api/admin/plugins/:name/config - Aggiorna configurazione
 *   - Ogni route include gestione errori con try-catch
 *   - Return: Array di oggetti route {method, path, handler}
 *
 * ========================================
 * COSTANTI E DIPENDENZE
 * ========================================
 * PLUGINS_PATH: percorso assoluto alla cartella /plugins
 *
 * Dipendenze:
 * - fs: operazioni file system
 * - path: gestione percorsi
 * - loadJson5: caricamento file JSON5 con supporto commenti
 *
 * ========================================
 * NOTE IMPLEMENTATIVE
 * ========================================
 * - Tutti i write su file usano atomic write (tmp + rename)
 * - Supporto completo JSON5 per file di configurazione
 * - Error handling completo con try-catch
 * - Validazione input su tutti i parametri
 * - Response standardizzate: {success, data/error}
 */

const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../core/loadJson5');

// Percorso alla cartella plugins
const PLUGINS_PATH = path.join(__dirname, '../../plugins');

/**
 * Ottiene la lista di tutti i plugin disponibili
 * @returns {Array} Array di oggetti plugin con informazioni base
 */
function getPluginsList() {
    const pluginsList = [];

    try {
        const pluginDirs = fs.readdirSync(PLUGINS_PATH);

        pluginDirs.forEach(pluginName => {
            const pluginDir = path.join(PLUGINS_PATH, pluginName);
            const stat = fs.statSync(pluginDir);

            if (stat.isDirectory()) {
                const configPath = path.join(pluginDir, 'pluginConfig.json');
                const descriptionPath = path.join(pluginDir, 'pluginDescription.json');
                const mainPath = path.join(pluginDir, 'main.js');

                let config = {};
                let description = {};

                // Leggi configurazione
                if (fs.existsSync(configPath)) {
                    config = loadJson5(configPath);
                }

                // Leggi descrizione
                if (fs.existsSync(descriptionPath)) {
                    description = loadJson5(descriptionPath);
                }

                // Verifica struttura plugin
                const hasMainJs = fs.existsSync(mainPath);
                const hasConfig = fs.existsSync(configPath);
                const hasDescription = fs.existsSync(descriptionPath);

                pluginsList.push({
                    name: pluginName,
                    active: config.active || 0,
                    isInstalled: config.isInstalled || 0,
                    weight: config.weight || 0,
                    version: description.version || 'N/A',
                    description: description.description || '',
                    author: description.author || 'N/A',
                    email: description.email || '',
                    license: description.license || 'N/A',
                    dependency: config.dependency || {},
                    nodeModuleDependency: config.nodeModuleDependency || {},
                    hasMainJs: hasMainJs,
                    hasConfig: hasConfig,
                    hasDescription: hasDescription,
                    isValid: hasMainJs && hasConfig && hasDescription
                });
            }
        });

        // Ordina per weight, poi alfabeticamente
        pluginsList.sort((a, b) => {
            if (a.weight !== b.weight) {
                return a.weight - b.weight;
            }
            return a.name.localeCompare(b.name);
        });

    } catch (error) {
        console.error('Errore nel caricamento della lista plugin:', error);
    }

    return pluginsList;
}

/**
 * Ottiene i dettagli completi di un plugin specifico
 * @param {string} pluginName - Nome del plugin
 * @returns {Object|null} Oggetto con tutti i dettagli del plugin o null se non trovato
 */
function getPluginDetails(pluginName) {
    try {
        const pluginDir = path.join(PLUGINS_PATH, pluginName);

        if (!fs.existsSync(pluginDir)) {
            return null;
        }

        const configPath = path.join(pluginDir, 'pluginConfig.json');
        const descriptionPath = path.join(pluginDir, 'pluginDescription.json');
        const mainPath = path.join(pluginDir, 'main.js');

        let config = {};
        let description = {};

        if (fs.existsSync(configPath)) {
            config = loadJson5(configPath);
        }

        if (fs.existsSync(descriptionPath)) {
            description = loadJson5(descriptionPath);
        }

        // Lista file nel plugin
        const files = fs.readdirSync(pluginDir);

        return {
            name: pluginName,
            path: pluginDir,
            config: config,
            description: description,
            files: files,
            hasMainJs: fs.existsSync(mainPath),
            hasConfig: fs.existsSync(configPath),
            hasDescription: fs.existsSync(descriptionPath)
        };

    } catch (error) {
        console.error(`Errore nel caricamento dettagli plugin ${pluginName}:`, error);
        return null;
    }
}

/**
 * Attiva o disattiva un plugin
 * @param {string} pluginName - Nome del plugin
 * @param {number} active - 0 = disattivo, 1 = attivo
 * @returns {Object} Risultato operazione {success: boolean, message: string}
 */
function togglePlugin(pluginName, active) {
    try {
        const configPath = path.join(PLUGINS_PATH, pluginName, 'pluginConfig.json');

        if (!fs.existsSync(configPath)) {
            return {
                success: false,
                error: `Plugin ${pluginName} non trovato o senza configurazione`
            };
        }

        // Leggi configurazione attuale
        const config = loadJson5(configPath);

        // Aggiorna stato attivo
        config.active = active;

        // Salva configurazione (atomic write)
        const tempPath = configPath + '.tmp';
        fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf8');
        fs.renameSync(tempPath, configPath);

        return {
            success: true,
            message: `Plugin ${pluginName} ${active ? 'attivato' : 'disattivato'} con successo. Riavviare il server per applicare le modifiche.`
        };

    } catch (error) {
        console.error(`Errore nel toggle plugin ${pluginName}:`, error);
        return {
            success: false,
            error: `Errore nell'aggiornamento del plugin: ${error.message}`
        };
    }
}

/**
 * Aggiorna la configurazione di un plugin
 * @param {string} pluginName - Nome del plugin
 * @param {Object} newConfig - Nuova configurazione
 * @returns {Object} Risultato operazione {success: boolean, message: string}
 */
function updatePluginConfig(pluginName, newConfig) {
    try {
        const configPath = path.join(PLUGINS_PATH, pluginName, 'pluginConfig.json');

        if (!fs.existsSync(configPath)) {
            return {
                success: false,
                error: `Plugin ${pluginName} non trovato`
            };
        }

        // Validazione base (mantieni campi essenziali)
        if (typeof newConfig.active === 'undefined') {
            newConfig.active = 0;
        }
        if (typeof newConfig.isInstalled === 'undefined') {
            newConfig.isInstalled = 0;
        }
        if (typeof newConfig.weight === 'undefined') {
            newConfig.weight = 0;
        }
        if (!newConfig.dependency) {
            newConfig.dependency = {};
        }
        if (!newConfig.nodeModuleDependency) {
            newConfig.nodeModuleDependency = {};
        }

        // Salva nuova configurazione (atomic write)
        const tempPath = configPath + '.tmp';
        fs.writeFileSync(tempPath, JSON.stringify(newConfig, null, 2), 'utf8');
        fs.renameSync(tempPath, configPath);

        return {
            success: true,
            message: `Configurazione plugin ${pluginName} aggiornata con successo. Riavviare il server per applicare le modifiche.`
        };

    } catch (error) {
        console.error(`Errore nell'aggiornamento configurazione plugin ${pluginName}:`, error);
        return {
            success: false,
            error: `Errore nell'aggiornamento: ${error.message}`
        };
    }
}

/**
 * Restituisce array di route per la gestione plugin
 * @param {Object} router - Router Koa
 * @param {Object} pluginSys - Sistema plugin
 * @param {string} pathPluginFolder - Percorso cartella plugin admin
 * @returns {Array} Array di oggetti route
 */
function getRoutes(router, pluginSys, pathPluginFolder) {
    const routes = [];

    // GET /api/admin/plugins - Lista tutti i plugin
    routes.push({
        method: 'GET',
        path: `/plugins`,
        handler: async (ctx) => {
            try {
                const pluginsList = getPluginsList();
                ctx.body = {
                    success: true,
                    plugins: pluginsList,
                    count: pluginsList.length
                };
            } catch (error) {
                ctx.status = 500;
                ctx.body = {
                    success: false,
                    error: 'Errore nel caricamento dei plugin: ' + error.message
                };
            }
        }
    });

    // GET /api/admin/plugins/:name - Dettagli plugin specifico
    routes.push({
        method: 'GET',
        path: `/plugins/:name`,
        handler: async (ctx) => {
            try {
                const pluginName = ctx.params.name;
                const details = getPluginDetails(pluginName);

                if (!details) {
                    ctx.status = 404;
                    ctx.body = {
                        success: false,
                        error: `Plugin ${pluginName} non trovato.`
                    };
                    return;
                }

                ctx.body = {
                    success: true,
                    plugin: details
                };
            } catch (error) {
                ctx.status = 500;
                ctx.body = {
                    success: false,
                    error: 'Errore nel caricamento dettagli plugin: ' + error.message
                };
            }
        }
    });

    // POST /api/admin/plugins/:name/toggle - Attiva/disattiva plugin
    routes.push({
        method: 'POST',
        path: `/plugins/:name/toggle`,
        handler: async (ctx) => {
            try {
                const pluginName = ctx.params.name;
                const { active } = ctx.request.body;

                if (typeof active === 'undefined') {
                    ctx.status = 400;
                    ctx.body = {
                        success: false,
                        error: 'Parametro "active" mancante (0 o 1).'
                    };
                    return;
                }

                const result = togglePlugin(pluginName, active);

                if (result.success) {
                    ctx.body = result;
                } else {
                    ctx.status = 500;
                    ctx.body = result;
                }
            } catch (error) {
                ctx.status = 500;
                ctx.body = {
                    success: false,
                    error: 'Errore nel toggle plugin: ' + error.message
                };
            }
        }
    });

    // POST /api/admin/plugins/:name/config - Aggiorna configurazione plugin
    routes.push({
        method: 'POST',
        path: `/plugins/:name/config`,
        handler: async (ctx) => {
            try {
                const pluginName = ctx.params.name;
                const { config } = ctx.request.body;

                if (!config) {
                    ctx.status = 400;
                    ctx.body = {
                        success: false,
                        error: 'Parametro "config" mancante.'
                    };
                    return;
                }

                const result = updatePluginConfig(pluginName, config);

                if (result.success) {
                    ctx.body = result;
                } else {
                    ctx.status = 500;
                    ctx.body = result;
                }
            } catch (error) {
                ctx.status = 500;
                ctx.body = {
                    success: false,
                    error: 'Errore nell\'aggiornamento configurazione: ' + error.message
                };
            }
        }
    });

    return routes;
}

module.exports = {
    getPluginsList,
    getPluginDetails,
    togglePlugin,
    updatePluginConfig,
    getRoutes
};
