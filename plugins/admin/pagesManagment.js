/**
 * ============================================================================
 * PAGES MANAGEMENT MODULE
 * Modulo per la gestione delle pagine web (.ejs) nel pannello di amministrazione
 * ============================================================================
 *
 * INDICE FUNZIONI:
 *
 * 1. getPagesList()
 *    - Ritorna la lista di tutte le pagine .ejs nella cartella /www
 *    - Scansione ricorsiva delle sottocartelle
 *    - Include: path relativo, dimensione file, data modifica
 *
 * 2. getPageDetails(pagePath)
 *    - Ritorna i dettagli completi di una pagina specifica
 *    - Include: contenuto del file, metadati, path assoluto
 *    - Verifica esistenza e validità del file
 *
 * 3. createPage(pagePath, content, createMissingFolders)
 *    - Crea una nuova pagina .ejs
 *    - Supporta creazione automatica cartelle intermedie
 *    - Validazione: verifica che non esista già
 *
 * 4. updatePage(pagePath, content)
 *    - Modifica il contenuto di una pagina esistente
 *    - Salvataggio atomico (file temporaneo + rename)
 *    - Validazione: verifica esistenza file
 *
 * 5. deletePage(pagePath)
 *    - Elimina una pagina .ejs
 *    - Validazione: verifica esistenza prima di eliminare
 *    - Sicurezza: verifica che il path sia dentro /www
 *
 * 6. createFolder(folderPath)
 *    - Crea una nuova cartella in /www
 *    - Supporto creazione ricorsiva (mkdir -p)
 *    - Validazione: path deve essere dentro /www
 *
 * 7. deleteFolder(folderPath)
 *    - Elimina una cartella vuota in /www
 *    - Sicurezza: verifica che sia vuota prima di eliminare
 *    - Validazione: path deve essere dentro /www
 *
 * 8. getRoutes()
 *    - Genera array di route Koa per l'API
 *    - Endpoint disponibili:
 *      GET  /api/admin/pages              -> Lista pagine
 *      GET  /api/admin/pages/detail       -> Dettagli pagina (query: path)
 *      POST /api/admin/pages/create       -> Crea pagina
 *      POST /api/admin/pages/update       -> Modifica pagina
 *      POST /api/admin/pages/delete       -> Elimina pagina
 *      POST /api/admin/pages/createFolder -> Crea cartella
 *      POST /api/admin/pages/deleteFolder -> Elimina cartella
 *
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const loadJson5 = require('../../core/loadJson5');

/**
 * Risolve dinamicamente il percorso della cartella www in base alla configurazione del tema attivo
 *
 * LOGICA DI RISOLUZIONE:
 * 1. Legge ital8Config.json per ottenere il tema pubblico attivo (activeTheme)
 * 2. Legge themeConfig.json del tema attivo
 * 3. Se wwwCustomPath è abilitato (1) e wwwCustomPathValue è settato:
 *    - Usa il path custom relativo alla root del tema
 *    - VALIDAZIONE SICUREZZA: il path deve essere esattamente "www" (cartella www dentro il tema)
 * 4. Altrimenti usa il path standard /www dalla root del progetto
 *
 * SICUREZZA:
 * - Solo due possibilità ammesse:
 *   A) /www standard (root progetto)
 *   B) themes/[nomeDelTema]/www (www dentro il tema)
 * - Qualsiasi altro path viene rifiutato e si fa fallback al path standard
 *
 * @returns {string} Path assoluto alla cartella www da utilizzare
 */
function getWwwPath() {
    try {
        // Carica configurazione globale
        const ital8Config = loadJson5(path.join(__dirname, '../../ital8Config.json'));
        const activeTheme = ital8Config.activeTheme;

        // Path del tema attivo
        const themePath = path.join(__dirname, '../../themes', activeTheme);
        const themeConfigPath = path.join(themePath, 'themeConfig.json');

        // Verifica esistenza themeConfig.json
        if (!fs.existsSync(themeConfigPath)) {
            console.warn(`[pagesManagment] themeConfig.json non trovato per tema ${activeTheme}. Uso path standard /www`);
            return path.join(__dirname, '../../www');
        }

        // Carica configurazione tema
        const themeConfig = loadJson5(themeConfigPath);

        // Se wwwCustomPath è abilitato e wwwCustomPathValue è settato
        if (themeConfig.wwwCustomPath === 1 && themeConfig.wwwCustomPathValue) {
            // Il path custom deve essere relativo alla root del tema
            const customPath = path.join(themePath, themeConfig.wwwCustomPathValue);

            // VALIDAZIONE SICUREZZA RIGOROSA:
            // Il path risolto deve essere esattamente themes/[nomeDelTema]/www
            const normalizedCustomPath = path.normalize(customPath);
            const expectedThemeWwwPath = path.normalize(path.join(themePath, 'www'));

            if (normalizedCustomPath === expectedThemeWwwPath) {
                // Verifica che la directory esista
                if (fs.existsSync(customPath)) {
                    console.log(`[pagesManagment] Uso www custom del tema: ${customPath}`);
                    return customPath;
                } else {
                    console.warn(`[pagesManagment] Directory www custom non esistente: ${customPath}. Uso path standard.`);
                    return path.join(__dirname, '../../www');
                }
            } else {
                // Path custom non valido - BLOCCO PER SICUREZZA
                console.error(`[pagesManagment] SICUREZZA: Path custom non valido per tema ${activeTheme}: "${themeConfig.wwwCustomPathValue}". Solo "www" è ammesso. Uso path standard.`);
                return path.join(__dirname, '../../www');
            }
        }

        // Default: usa /www standard dalla root del progetto
        return path.join(__dirname, '../../www');

    } catch (error) {
        console.error(`[pagesManagment] Errore nella risoluzione del path www:`, error);
        // Fallback sicuro al path standard in caso di errore
        return path.join(__dirname, '../../www');
    }
}

// Percorso alla cartella www (web root) - risolto dinamicamente
// NOTA: Questo viene chiamato ad ogni accesso per rispettare eventuali cambi di tema
// Se servono performance, si può cachare e invalidare al cambio tema

/**
 * Funzione helper: scansione ricorsiva di una directory per trovare file .ejs
 * @param {string} dirPath - Percorso directory da scansionare
 * @param {string} basePath - Percorso base per calcolare path relativi
 * @returns {Array} Array di oggetti file con dettagli
 */
function scanDirectory(dirPath, basePath) {
    let files = [];

    try {
        const items = fs.readdirSync(dirPath);

        items.forEach(item => {
            const itemPath = path.join(dirPath, item);
            const stat = fs.statSync(itemPath);
            const relativePath = path.relative(basePath, itemPath);

            if (stat.isDirectory()) {
                // Ricorsione nelle sottocartelle
                files = files.concat(scanDirectory(itemPath, basePath));
            } else if (stat.isFile() && item.endsWith('.ejs')) {
                // File .ejs trovato
                files.push({
                    path: relativePath.replace(/\\/g, '/'), // Normalizza path per Windows
                    name: item,
                    size: stat.size,
                    modified: stat.mtime,
                    created: stat.birthtime,
                    directory: path.dirname(relativePath).replace(/\\/g, '/')
                });
            }
        });
    } catch (error) {
        console.error(`[pagesManagment] Errore scansione directory ${dirPath}:`, error.message);
    }

    return files;
}

/**
 * Funzione helper: valida che un path sia dentro /www (sicurezza)
 * @param {string} filePath - Path relativo da validare
 * @returns {boolean} true se valido, false altrimenti
 */
function isPathSafe(filePath) {
    // Ottieni il path www corrente (dinamico in base al tema)
    const wwwPath = getWwwPath();

    // Risolvi path assoluto
    const absolutePath = path.join(wwwPath, filePath);
    const normalizedPath = path.normalize(absolutePath);

    // Verifica che il path normalizzato sia dentro wwwPath
    return normalizedPath.startsWith(wwwPath);
}

/**
 * Ottiene la lista di tutte le pagine .ejs in /www
 * @returns {Array} Array di oggetti pagina con dettagli
 */
function getPagesList() {
    try {
        const wwwPath = getWwwPath();
        const pages = scanDirectory(wwwPath, wwwPath);

        // Ordina per path alfabetico
        pages.sort((a, b) => a.path.localeCompare(b.path));

        return pages;
    } catch (error) {
        console.error('[pagesManagment] Errore in getPagesList:', error);
        return [];
    }
}

/**
 * Ottiene i dettagli completi di una pagina specifica
 * @param {string} pagePath - Path relativo della pagina (es: "index.ejs" o "reserved/page.ejs")
 * @returns {object} Oggetto con dettagli pagina o errore
 */
function getPageDetails(pagePath) {
    try {
        // Validazione sicurezza
        if (!isPathSafe(pagePath)) {
            return {
                success: false,
                error: 'Path non valido o fuori da /www'
            };
        }

        const wwwPath = getWwwPath();
        const absolutePath = path.join(wwwPath, pagePath);

        // Verifica esistenza
        if (!fs.existsSync(absolutePath)) {
            return {
                success: false,
                error: `La pagina "${pagePath}" non esiste`
            };
        }

        // Verifica che sia un file
        const stat = fs.statSync(absolutePath);
        if (!stat.isFile()) {
            return {
                success: false,
                error: `"${pagePath}" non è un file`
            };
        }

        // Leggi contenuto
        const content = fs.readFileSync(absolutePath, 'utf8');

        return {
            success: true,
            page: {
                path: pagePath,
                absolutePath: absolutePath,
                name: path.basename(pagePath),
                directory: path.dirname(pagePath),
                content: content,
                size: stat.size,
                modified: stat.mtime,
                created: stat.birthtime,
                encoding: 'utf8'
            }
        };

    } catch (error) {
        console.error('[pagesManagment] Errore in getPageDetails:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Crea una nuova pagina .ejs
 * @param {string} pagePath - Path relativo della pagina da creare
 * @param {string} content - Contenuto della pagina
 * @param {boolean} createMissingFolders - Se true, crea cartelle intermedie se mancano
 * @returns {object} Risultato operazione
 */
function createPage(pagePath, content = '', createMissingFolders = true) {
    try {
        // Validazione parametri
        if (!pagePath) {
            return {
                success: false,
                error: 'Parametro pagePath mancante'
            };
        }

        // Validazione sicurezza
        if (!isPathSafe(pagePath)) {
            return {
                success: false,
                error: 'Path non valido o fuori da /www'
            };
        }

        // Verifica estensione .ejs
        if (!pagePath.endsWith('.ejs')) {
            return {
                success: false,
                error: 'La pagina deve avere estensione .ejs'
            };
        }

        const wwwPath = getWwwPath();
        const absolutePath = path.join(wwwPath, pagePath);

        // Verifica che NON esista già
        if (fs.existsSync(absolutePath)) {
            return {
                success: false,
                error: `La pagina "${pagePath}" esiste già`
            };
        }

        // Crea directory intermedie se necessario
        const dirPath = path.dirname(absolutePath);
        if (!fs.existsSync(dirPath)) {
            if (createMissingFolders) {
                fs.mkdirSync(dirPath, { recursive: true });
            } else {
                return {
                    success: false,
                    error: `La directory "${path.dirname(pagePath)}" non esiste`
                };
            }
        }

        // Crea file
        fs.writeFileSync(absolutePath, content, 'utf8');

        return {
            success: true,
            message: `Pagina "${pagePath}" creata con successo`,
            page: {
                path: pagePath,
                absolutePath: absolutePath
            }
        };

    } catch (error) {
        console.error('[pagesManagment] Errore in createPage:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Modifica il contenuto di una pagina esistente
 * @param {string} pagePath - Path relativo della pagina
 * @param {string} content - Nuovo contenuto
 * @returns {object} Risultato operazione
 */
function updatePage(pagePath, content) {
    try {
        // Validazione parametri
        if (!pagePath) {
            return {
                success: false,
                error: 'Parametro pagePath mancante'
            };
        }

        if (typeof content !== 'string') {
            return {
                success: false,
                error: 'Parametro content deve essere una stringa'
            };
        }

        // Validazione sicurezza
        if (!isPathSafe(pagePath)) {
            return {
                success: false,
                error: 'Path non valido o fuori da /www'
            };
        }

        const wwwPath = getWwwPath();
        const absolutePath = path.join(wwwPath, pagePath);

        // Verifica esistenza
        if (!fs.existsSync(absolutePath)) {
            return {
                success: false,
                error: `La pagina "${pagePath}" non esiste`
            };
        }

        // Salvataggio atomico (file temporaneo + rename)
        const tempPath = absolutePath + '.tmp';
        fs.writeFileSync(tempPath, content, 'utf8');
        fs.renameSync(tempPath, absolutePath);

        return {
            success: true,
            message: `Pagina "${pagePath}" modificata con successo`,
            page: {
                path: pagePath,
                absolutePath: absolutePath
            }
        };

    } catch (error) {
        console.error('[pagesManagment] Errore in updatePage:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Elimina una pagina .ejs
 * @param {string} pagePath - Path relativo della pagina
 * @returns {object} Risultato operazione
 */
function deletePage(pagePath) {
    try {
        // Validazione parametri
        if (!pagePath) {
            return {
                success: false,
                error: 'Parametro pagePath mancante'
            };
        }

        // Validazione sicurezza
        if (!isPathSafe(pagePath)) {
            return {
                success: false,
                error: 'Path non valido o fuori da /www'
            };
        }

        const wwwPath = getWwwPath();
        const absolutePath = path.join(wwwPath, pagePath);

        // Verifica esistenza
        if (!fs.existsSync(absolutePath)) {
            return {
                success: false,
                error: `La pagina "${pagePath}" non esiste`
            };
        }

        // Verifica che sia un file
        const stat = fs.statSync(absolutePath);
        if (!stat.isFile()) {
            return {
                success: false,
                error: `"${pagePath}" non è un file`
            };
        }

        // Elimina file
        fs.unlinkSync(absolutePath);

        return {
            success: true,
            message: `Pagina "${pagePath}" eliminata con successo`
        };

    } catch (error) {
        console.error('[pagesManagment] Errore in deletePage:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Crea una nuova cartella in /www
 * @param {string} folderPath - Path relativo della cartella da creare
 * @returns {object} Risultato operazione
 */
function createFolder(folderPath) {
    try {
        // Validazione parametri
        if (!folderPath) {
            return {
                success: false,
                error: 'Parametro folderPath mancante'
            };
        }

        // Validazione sicurezza
        if (!isPathSafe(folderPath)) {
            return {
                success: false,
                error: 'Path non valido o fuori da /www'
            };
        }

        const wwwPath = getWwwPath();
        const absolutePath = path.join(wwwPath, folderPath);

        // Verifica che NON esista già
        if (fs.existsSync(absolutePath)) {
            return {
                success: false,
                error: `La cartella "${folderPath}" esiste già`
            };
        }

        // Crea cartella (ricorsivo)
        fs.mkdirSync(absolutePath, { recursive: true });

        return {
            success: true,
            message: `Cartella "${folderPath}" creata con successo`,
            folder: {
                path: folderPath,
                absolutePath: absolutePath
            }
        };

    } catch (error) {
        console.error('[pagesManagment] Errore in createFolder:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Elimina una cartella vuota in /www
 * @param {string} folderPath - Path relativo della cartella
 * @returns {object} Risultato operazione
 */
function deleteFolder(folderPath) {
    try {
        // Validazione parametri
        if (!folderPath) {
            return {
                success: false,
                error: 'Parametro folderPath mancante'
            };
        }

        // Validazione sicurezza
        if (!isPathSafe(folderPath)) {
            return {
                success: false,
                error: 'Path non valido o fuori da /www'
            };
        }

        // Protezione: non permettere di eliminare la root /www
        if (folderPath === '.' || folderPath === '' || folderPath === '/') {
            return {
                success: false,
                error: 'Non è possibile eliminare la cartella root /www'
            };
        }

        const wwwPath = getWwwPath();
        const absolutePath = path.join(wwwPath, folderPath);

        // Verifica esistenza
        if (!fs.existsSync(absolutePath)) {
            return {
                success: false,
                error: `La cartella "${folderPath}" non esiste`
            };
        }

        // Verifica che sia una directory
        const stat = fs.statSync(absolutePath);
        if (!stat.isDirectory()) {
            return {
                success: false,
                error: `"${folderPath}" non è una cartella`
            };
        }

        // Verifica che sia vuota
        const items = fs.readdirSync(absolutePath);
        if (items.length > 0) {
            return {
                success: false,
                error: `La cartella "${folderPath}" non è vuota (contiene ${items.length} elementi)`
            };
        }

        // Elimina cartella
        fs.rmdirSync(absolutePath);

        return {
            success: true,
            message: `Cartella "${folderPath}" eliminata con successo`
        };

    } catch (error) {
        console.error('[pagesManagment] Errore in deleteFolder:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Ottiene la lista di tutte le cartelle in /www
 * @returns {Array} Array di oggetti cartella
 */
function getFoldersList() {
    try {
        const folders = [];

        function scanFolders(dirPath, basePath) {
            try {
                const items = fs.readdirSync(dirPath);

                items.forEach(item => {
                    const itemPath = path.join(dirPath, item);
                    const stat = fs.statSync(itemPath);

                    if (stat.isDirectory()) {
                        const relativePath = path.relative(basePath, itemPath);
                        folders.push({
                            path: relativePath.replace(/\\/g, '/'),
                            name: item,
                            modified: stat.mtime,
                            created: stat.birthtime
                        });

                        // Ricorsione
                        scanFolders(itemPath, basePath);
                    }
                });
            } catch (error) {
                console.error(`[pagesManagment] Errore scansione cartelle ${dirPath}:`, error.message);
            }
        }

        const wwwPath = getWwwPath();
        scanFolders(wwwPath, wwwPath);

        // Ordina alfabeticamente
        folders.sort((a, b) => a.path.localeCompare(b.path));

        return folders;

    } catch (error) {
        console.error('[pagesManagment] Errore in getFoldersList:', error);
        return [];
    }
}

/**
 * Genera le route API per la gestione delle pagine
 * @returns {Array} Array di oggetti route per Koa
 */
function getRoutes() {
    const ital8Conf = loadJson5(path.join(__dirname, '../../ital8Config.json'));

    return [
        // GET /api/admin/pages - Lista tutte le pagine
        {
            method: 'GET',
            path: `/${ital8Conf.adminPrefix}/pages`,
            handler: async (ctx) => {
                try {
                    const pages = getPagesList();
                    const folders = getFoldersList();
                    const wwwPath = getWwwPath();

                    ctx.body = {
                        success: true,
                        pages: pages,
                        folders: folders,
                        pagesCount: pages.length,
                        foldersCount: folders.length,
                        wwwPath: wwwPath
                    };
                } catch (error) {
                    console.error('[pagesManagment] Errore GET /pages:', error);
                    ctx.status = 500;
                    ctx.body = {
                        success: false,
                        error: error.message
                    };
                }
            }
        },

        // GET /api/admin/pages/detail - Dettagli di una pagina (query: path)
        {
            method: 'GET',
            path: `/${ital8Conf.adminPrefix}/pages/detail`,
            handler: async (ctx) => {
                try {
                    const pagePath = ctx.query.path;

                    if (!pagePath) {
                        ctx.status = 400;
                        ctx.body = {
                            success: false,
                            error: 'Parametro "path" mancante nella query string'
                        };
                        return;
                    }

                    const result = getPageDetails(pagePath);

                    if (result.success) {
                        ctx.body = result;
                    } else {
                        ctx.status = 404;
                        ctx.body = result;
                    }
                } catch (error) {
                    console.error('[pagesManagment] Errore GET /pages/detail:', error);
                    ctx.status = 500;
                    ctx.body = {
                        success: false,
                        error: error.message
                    };
                }
            }
        },

        // POST /api/admin/pages/create - Crea una nuova pagina
        {
            method: 'POST',
            path: `/${ital8Conf.adminPrefix}/pages/create`,
            handler: async (ctx) => {
                try {
                    const { path: pagePath, content, createMissingFolders } = ctx.request.body;

                    if (!pagePath) {
                        ctx.status = 400;
                        ctx.body = {
                            success: false,
                            error: 'Parametro "path" mancante'
                        };
                        return;
                    }

                    const result = createPage(pagePath, content, createMissingFolders);

                    if (result.success) {
                        ctx.body = result;
                    } else {
                        ctx.status = 400;
                        ctx.body = result;
                    }
                } catch (error) {
                    console.error('[pagesManagment] Errore POST /pages/create:', error);
                    ctx.status = 500;
                    ctx.body = {
                        success: false,
                        error: error.message
                    };
                }
            }
        },

        // POST /api/admin/pages/update - Modifica una pagina
        {
            method: 'POST',
            path: `/${ital8Conf.adminPrefix}/pages/update`,
            handler: async (ctx) => {
                try {
                    const { path: pagePath, content } = ctx.request.body;

                    if (!pagePath) {
                        ctx.status = 400;
                        ctx.body = {
                            success: false,
                            error: 'Parametro "path" mancante'
                        };
                        return;
                    }

                    if (typeof content !== 'string') {
                        ctx.status = 400;
                        ctx.body = {
                            success: false,
                            error: 'Parametro "content" deve essere una stringa'
                        };
                        return;
                    }

                    const result = updatePage(pagePath, content);

                    if (result.success) {
                        ctx.body = result;
                    } else {
                        ctx.status = 400;
                        ctx.body = result;
                    }
                } catch (error) {
                    console.error('[pagesManagment] Errore POST /pages/update:', error);
                    ctx.status = 500;
                    ctx.body = {
                        success: false,
                        error: error.message
                    };
                }
            }
        },

        // POST /api/admin/pages/delete - Elimina una pagina
        {
            method: 'POST',
            path: `/${ital8Conf.adminPrefix}/pages/delete`,
            handler: async (ctx) => {
                try {
                    const { path: pagePath } = ctx.request.body;

                    if (!pagePath) {
                        ctx.status = 400;
                        ctx.body = {
                            success: false,
                            error: 'Parametro "path" mancante'
                        };
                        return;
                    }

                    const result = deletePage(pagePath);

                    if (result.success) {
                        ctx.body = result;
                    } else {
                        ctx.status = 400;
                        ctx.body = result;
                    }
                } catch (error) {
                    console.error('[pagesManagment] Errore POST /pages/delete:', error);
                    ctx.status = 500;
                    ctx.body = {
                        success: false,
                        error: error.message
                    };
                }
            }
        },

        // POST /api/admin/pages/createFolder - Crea una nuova cartella
        {
            method: 'POST',
            path: `/${ital8Conf.adminPrefix}/pages/createFolder`,
            handler: async (ctx) => {
                try {
                    const { path: folderPath } = ctx.request.body;

                    if (!folderPath) {
                        ctx.status = 400;
                        ctx.body = {
                            success: false,
                            error: 'Parametro "path" mancante'
                        };
                        return;
                    }

                    const result = createFolder(folderPath);

                    if (result.success) {
                        ctx.body = result;
                    } else {
                        ctx.status = 400;
                        ctx.body = result;
                    }
                } catch (error) {
                    console.error('[pagesManagment] Errore POST /pages/createFolder:', error);
                    ctx.status = 500;
                    ctx.body = {
                        success: false,
                        error: error.message
                    };
                }
            }
        },

        // POST /api/admin/pages/deleteFolder - Elimina una cartella vuota
        {
            method: 'POST',
            path: `/${ital8Conf.adminPrefix}/pages/deleteFolder`,
            handler: async (ctx) => {
                try {
                    const { path: folderPath } = ctx.request.body;

                    if (!folderPath) {
                        ctx.status = 400;
                        ctx.body = {
                            success: false,
                            error: 'Parametro "path" mancante'
                        };
                        return;
                    }

                    const result = deleteFolder(folderPath);

                    if (result.success) {
                        ctx.body = result;
                    } else {
                        ctx.status = 400;
                        ctx.body = result;
                    }
                } catch (error) {
                    console.error('[pagesManagment] Errore POST /pages/deleteFolder:', error);
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
    getPagesList,
    getPageDetails,
    createPage,
    updatePage,
    deletePage,
    createFolder,
    deleteFolder,
    getFoldersList,
    getRoutes
};
