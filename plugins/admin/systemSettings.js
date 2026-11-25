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
const setJson5Key = require('../../core/setJson5Key');

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
        'https'
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

    // Blocco https: la forma REALE del config. Le chiavi piatte useHttps / httpsPort /
    // AutoRedirectHttpPortToHttpsPort appartengono alla struttura precedente al blocco
    // annidato e non esistono più. Pretenderle rendeva il salvataggio IMPOSSIBILE: la
    // GUI è un editor che rimanda il config appena caricato, e il validatore lo
    // rifiutava sempre con "Campo obbligatorio mancante". Presidiato dal round-trip
    // getSystemConfig() -> validateSystemConfig() in tests/unit/admin/systemSettings.test.js
    if (config.https !== undefined) {
        if (typeof config.https !== 'object' || config.https === null || Array.isArray(config.https)) {
            errors.push('https deve essere un oggetto');
        } else {
            if (config.https.enabled !== undefined && typeof config.https.enabled !== 'boolean') {
                errors.push('https.enabled deve essere true o false');
            }
            if (config.https.port !== undefined) {
                // la porta può restare stringa vuota quando HTTPS non è configurato
                if (config.https.port !== '' && (typeof config.https.port !== 'number' || config.https.port < 1 || config.https.port > 65535)) {
                    errors.push('https.port deve essere un numero tra 1 e 65535 o stringa vuota');
                }
            }
            if (config.https.AutoRedirectHttpPortToHttpsPort !== undefined && typeof config.https.AutoRedirectHttpPortToHttpsPort !== 'boolean') {
                errors.push('https.AutoRedirectHttpPortToHttpsPort deve essere true o false');
            }
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

    return {
        valid: errors.length === 0,
        errors: errors
    };
}

/**
 * Elenca le FOGLIE che differiscono fra il config attuale e quello proposto.
 *
 * Confronta solo le chiavi presenti in `proposed`: una chiave che il form non
 * nomina non compare nel risultato, quindi non viene toccata. È il cuore della
 * correzione di B3 — la cancellazione per omissione diventa impossibile per
 * costruzione, non per diligenza.
 *
 * Gli array sono trattati come VALORI (non si fondono): sostituirli per intero è
 * il comportamento atteso quando un form li gestisce, e fonderli significherebbe
 * indovinare la posizione.
 *
 * @param {object} current
 * @param {object} proposed
 * @param {string[]} [prefix]
 * @returns {Array<{keyPath: string[], value: *}>}
 */
function diffLeaves(current, proposed, prefix = []) {
    const out = [];

    for (const [key, proposedValue] of Object.entries(proposed || {})) {
        const keyPath = [...prefix, key];
        const currentValue = current ? current[key] : undefined;

        const entrambiOggetti = proposedValue && typeof proposedValue === 'object' && !Array.isArray(proposedValue)
            && currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue);

        if (entrambiOggetti) {
            out.push(...diffLeaves(currentValue, proposedValue, keyPath));
            continue;
        }

        if (JSON.stringify(currentValue) !== JSON.stringify(proposedValue)) {
            out.push({ keyPath, value: proposedValue });
        }
    }

    return out;
}

/**
 * Copia `ital8Config.json5` sotto `backups/` prima di modificarlo.
 *
 * Non usa `BackupManager`: quello nomina le proprie cartelle `init-<timestamp>`,
 * cioè « esecuzione del wizard », e questa non lo è. Nota per chi mette ordine:
 * sotto `backups/` convivono ora TRE schemi di nomi (`backup-*` degli snapshot a
 * comando, `init-*` del wizard, e questo) — registrato in TODO.md.
 *
 * Fail-soft: se il backup non riesce, il salvataggio prosegue. La scrittura è
 * chirurgica e di per sé non distruttiva; impedire una modifica perché non si è
 * potuta copiare sarebbe peggio del rischio che evita.
 *
 * @param {string} configPath
 * @returns {string|null} percorso del backup, o null se non è stato possibile
 */
function backupConfigBeforeWrite(configPath) {
    try {
        const dir = path.join(__dirname, '../../backups', 'systemSettings');
        fs.mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const dest = path.join(dir, `${stamp}-ital8Config.json5`);
        fs.copyFileSync(configPath, dest);
        return dest;
    } catch (err) {
        console.warn(`[systemSettings] backup non riuscito (si prosegue): ${err.message}`);
        return null;
    }
}

/**
 * Aggiorna la configurazione di sistema
 * @param {object} newConfig - Nuova configurazione
 * @returns {object} Risultato operazione
 */
async function updateSystemConfig(newConfig) {
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

        // ── Scrittura CHIRURGICA, chiave per chiave (REVIEW.md → B3) ─────────
        //
        // Prima questa funzione faceva `JSON.stringify(newConfig)` con la sola
        // riga d'intestazione, cioè RIMPIAZZAVA il file intero con l'oggetto
        // arrivato dal form. Due conseguenze, entrambe misurate:
        //
        //  1. Tutti i commenti spariscono. Misurato su un'installazione reale:
        //     `ital8Config.json5` ridotto da 214 righe di commento a ZERO. Quei
        //     commenti sono metà del valore del file — spiegano cosa fa ogni
        //     chiave a chi la rilegge sei mesi dopo.
        //  2. Ogni chiave che il form NON conosce viene CANCELLATA. Il form
        //     copre una ventina di chiavi; il file ne ha molte di più
        //     (`securityHeaders`, `cli`, `migrations`, `globalFunctionsWhitelist`,
        //     `maintenance`...). Il messaggio diceva « riavvia il server per
        //     applicare le modifiche », e il riavvio era il momento in cui
        //     l'installazione moriva.
        //
        // Ora si scrive SOLO ciò che è cambiato, foglia per foglia, con
        // `setJson5Key`: i commenti restano e le chiavi che il form non nomina
        // non vengono toccate — non per attenzione di chi scrive il form, ma
        // perché la scrittura non le vede.
        const changed = diffLeaves(currentConfig, newConfig);

        if (changed.length === 0) {
            return {
                success: true,
                message: 'Nessuna modifica da salvare.',
                warnings: warnings.length > 0 ? warnings : null,
                needsRestart: false
            };
        }

        // Copia di sicurezza prima di toccare il file: una porta sbagliata si
        // recupera, un file perso no.
        const backupPath = backupConfigBeforeWrite(configPath);

        // ── Tutto-o-niente (rilievo della revisione v3.51.0) ─────────────────
        //
        // Le chiavi si applicano a una COPIA, che prende il posto dell'originale
        // solo se tutte sono andate a buon fine. Prima il ciclo scriveva in
        // posto: un errore a metà — un `setJson5Key` che non trova il path, un
        // disco pieno — lasciava alcune chiavi scritte e altre no, rispondeva
        // con un errore generico e non restituiva nemmeno il `backupPath`, cioè
        // non diceva dove recuperare. Una configurazione a metà è peggio di una
        // modifica rifiutata.
        const tempPath = `${configPath}.applying`;
        fs.copyFileSync(configPath, tempPath);

        try {
            for (const { keyPath, value } of changed) {
                await setJson5Key(tempPath, keyPath, value);
            }
            // Lo scambio è atomico: o c'è il file di prima, o quello nuovo.
            fs.renameSync(tempPath, configPath);
        } catch (err) {
            try { fs.unlinkSync(tempPath); } catch (_) { /* potrebbe non esistere */ }
            return {
                success: false,
                error: `Scrittura annullata: ${err.message}. Nessuna chiave è stata modificata.`,
                changedKeys: changed.map((c) => c.keyPath.join('.')),
                backupPath,
            };
        }

        return {
            success: true,
            message: `Configurazione aggiornata con successo (${changed.length} `
                + `${changed.length === 1 ? 'chiave' : 'chiavi'}). Riavvia il server per applicare le modifiche.`,
            changedKeys: changed.map((c) => c.keyPath.join('.')),
            backupPath,
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
            access: { requiresAuth: true, allowedRoles: [0, 1] }, // Admin only - leggi configurazione sistema
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
            access: { requiresAuth: true, allowedRoles: [0, 1] }, // Admin only - modifica configurazione sistema
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

                    const result = await updateSystemConfig(config);

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
    getRoutes,
    // Esportata per il presidio di REVIEW.md → B3: è la funzione che rende
    // impossibile la cancellazione per omissione, e va verificabile da sola.
    diffLeaves
};
