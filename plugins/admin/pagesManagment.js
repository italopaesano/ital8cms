/**
 * ============================================================================
 * PAGES MANAGEMENT MODULE
 * Modulo per la gestione delle pagine web (.ejs) nel pannello di amministrazione
 * ============================================================================
 *
 * RISOLUZIONE DINAMICA PATH WWW:
 * ================================
 * Il path della cartella www viene risolto dinamicamente in base al tema attivo.
 *
 * CONFIGURAZIONE (in themes/[nomeDelTema]/themeConfig.json):
 * - wwwCustomPath: 0 = usa /www standard (root progetto)
 *                  1 = usa themes/[nomeDelTema]/www (cartella www nella root del tema)
 *
 * ESEMPIO:
 * {
 *   "wwwCustomPath": 0,  // Usa /www standard
 *   ...
 * }
 *
 * SICUREZZA:
 * - Solo DUE location ammesse:
 *   A) /www (root progetto)
 *   B) themes/[nomeDelTema]/www (www dentro il tema)
 * - Il path è FISSO e NON configurabile (nessuna variabile stringa)
 * - Questo previene path traversal e accessi non autorizzati
 * - L'interfaccia gestisce SOLO file pubblici, MAI file di amministrazione o core
 *
 * ============================================================================
 *
 * INDICE FUNZIONI:
 *
 * 0. getWwwPath()
 *    - Risolve dinamicamente il path www in base al tema attivo
 *    - Legge wwwCustomPath dal themeConfig.json del tema
 *    - Fallback sicuro a /www in caso di errore
 *
 * 1. getPagesList()
 *    - Ritorna la lista di tutte le pagine .ejs nella cartella www (dinamica)
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
 *    - Sicurezza: verifica che il path sia dentro www
 *
 * 6. createFolder(folderPath)
 *    - Crea una nuova cartella nella www
 *    - Supporto creazione ricorsiva (mkdir -p)
 *    - Validazione: path deve essere dentro www
 *
 * 7. deleteFolder(folderPath)
 *    - Elimina una cartella vuota nella www
 *    - Sicurezza: verifica che sia vuota prima di eliminare
 *    - Validazione: path deve essere dentro www
 *
 * 8. getFoldersList()
 *    - Ritorna la lista di tutte le cartelle nella www
 *    - Scansione ricorsiva
 *
 * 9. extractPlaceholders(content)
 *    - Estrae tutti i blocchi PLACEHOLDER da un contenuto EJS
 *    - Ritorna array di oggetti con attributi e contenuto default
 *
 * 10. parsePlaceholderAttributes(attributesString)
 *    - Parsa gli attributi di un tag PLACEHOLDER
 *    - Supporta valori quoted, unquoted, booleani, numeri
 *
 * 11. replacePlaceholderContent(content, placeholderValues)
 *    - Sostituisce il contenuto dei blocchi PLACEHOLDER mantenendo i tag
 *    - Usato per creare/aggiornare pagine da template
 *
 * 12. generatePageMetadata(themeName, templatePath, createdDate)
 *    - Genera il commento metadata per una pagina generata
 *    - Include: tema, template, created, last modified
 *
 * 13. updatePageMetadata(content)
 *    - Aggiorna il timestamp "Last modified" nel metadata
 *
 * 14. extractThemeFromMetadata(content)
 *    - Estrae il nome del tema dal metadata della pagina
 *
 * 15. extractTemplateFromMetadata(content)
 *    - Estrae il path del template dal metadata della pagina
 *
 * 16. getRoutes()
 *    - Genera array di route Koa per l'API
 *    - Endpoint disponibili:
 *      GET  /api/admin/pages                      -> Lista pagine
 *      GET  /api/admin/pages/detail               -> Dettagli pagina (query: path)
 *      POST /api/admin/pages/create               -> Crea pagina
 *      POST /api/admin/pages/update               -> Modifica pagina
 *      POST /api/admin/pages/delete               -> Elimina pagina
 *      POST /api/admin/pages/createFolder         -> Crea cartella
 *      POST /api/admin/pages/deleteFolder         -> Elimina cartella
 *      GET  /api/admin/pages/info                 -> Info tema e template
 *      GET  /api/admin/pages/parseTemplate        -> Parsing template per PLACEHOLDER
 *      GET  /api/admin/pages/parsePage            -> Parsing pagina esistente
 *      POST /api/admin/pages/createFromTemplate   -> Crea pagina da template
 *      POST /api/admin/pages/updateWithPlaceholders -> Aggiorna pagina con PLACEHOLDER
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
 * 3. Se wwwCustomPath === 1:
 *    - Usa themes/[nomeDelTema]/www (cartella www dentro la root del tema)
 *    - Verifica che la directory esista
 * 4. Se wwwCustomPath === 0 (o non settato):
 *    - Usa /www standard dalla root del progetto
 *
 * SICUREZZA:
 * - Solo DUE possibilità ammesse:
 *   A) wwwCustomPath: 0 → /www standard (root progetto)
 *   B) wwwCustomPath: 1 → themes/[nomeDelTema]/www (www dentro il tema)
 * - Il path è fisso e non configurabile per evitare path traversal e accessi non autorizzati
 * - Qualsiasi errore porta a fallback sicuro su /www standard
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

        // Se wwwCustomPath è abilitato (1), usa la cartella www dentro il tema
        if (themeConfig.wwwCustomPath === 1) {
            // Path fisso: themes/[nomeDelTema]/www
            const themeWwwPath = path.join(themePath, 'www');

            // Verifica che la directory esista
            if (fs.existsSync(themeWwwPath)) {
                console.log(`[pagesManagment] Uso www del tema: ${themeWwwPath}`);
                return themeWwwPath;
            } else {
                console.warn(`[pagesManagment] Directory www non trovata nel tema ${activeTheme}. Uso path standard /www`);
                return path.join(__dirname, '../../www');
            }
        }

        // Default (wwwCustomPath === 0 o non settato): usa /www standard dalla root del progetto
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
 * ============================================================================
 * PLACEHOLDER PARSING UTILITIES
 * Funzioni per gestire il sistema PLACEHOLDER per template editabili
 * ============================================================================
 */

/**
 * Estrae tutti i blocchi PLACEHOLDER da un contenuto EJS
 * @param {string} content - Contenuto del file EJS
 * @returns {Array} Array di oggetti placeholder con attributi e contenuto
 */
function extractPlaceholders(content) {
    const placeholders = [];

    // Regex per catturare blocchi PLACEHOLDER
    // Formato: <%# PLACEHOLDER attributi %> contenuto <%# /PLACEHOLDER %>
    const placeholderRegex = /<%#\s*PLACEHOLDER\s+([^%]+)%>([\s\S]*?)<%#\s*\/PLACEHOLDER\s*%>/g;

    let match;
    while ((match = placeholderRegex.exec(content)) !== null) {
        const attributesString = match[1].trim();
        const defaultContent = match[2];

        // Parsa gli attributi
        const attributes = parsePlaceholderAttributes(attributesString);

        placeholders.push({
            fullMatch: match[0],           // Intero blocco PLACEHOLDER
            attributes: attributes,         // Attributi parsati
            defaultContent: defaultContent, // Contenuto di default
            name: attributes.name,          // Nome univoco
            type: attributes.type,          // Tipo (text, html, etc)
            label: attributes.label || attributes.name, // Label per UI
            description: attributes.description || '',
            required: attributes.required === 'true' || attributes.required === true,
            // Altri attributi specifici per tipo
            ...attributes
        });
    }

    return placeholders;
}

/**
 * Parsa gli attributi di un tag PLACEHOLDER
 * Formato: name:value name2:"value with spaces" name3:123 name4:true
 * @param {string} attributesString - Stringa attributi
 * @returns {Object} Oggetto con attributi parsati
 */
function parsePlaceholderAttributes(attributesString) {
    const attributes = {};

    // Regex per catturare coppie chiave:valore
    // Supporta: key:value, key:"value with spaces", key:123, key:true
    const attrRegex = /(\w+):(?:"([^"]*)"|([^\s]+))/g;

    let match;
    while ((match = attrRegex.exec(attributesString)) !== null) {
        const key = match[1];
        const value = match[2] || match[3]; // Match[2] se quoted, match[3] se unquoted

        // Converti booleani e numeri
        if (value === 'true' || value === 'false') {
            attributes[key] = value === 'true';
        } else if (!isNaN(value) && value !== '') {
            attributes[key] = Number(value);
        } else {
            attributes[key] = value;
        }
    }

    return attributes;
}

/**
 * Sostituisce il contenuto dei blocchi PLACEHOLDER mantenendo i tag
 * @param {string} content - Contenuto originale del file
 * @param {Object} placeholderValues - Oggetto con name:newContent
 * @returns {string} Contenuto aggiornato
 */
function replacePlaceholderContent(content, placeholderValues) {
    let updatedContent = content;

    // Per ogni placeholder, sostituisci solo il contenuto tra i tag
    for (const [name, newValue] of Object.entries(placeholderValues)) {
        // Regex per trovare il blocco PLACEHOLDER specifico per name
        // Usa escaped regex per il nome per evitare problemi con caratteri speciali
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(
            `(<%#\\s*PLACEHOLDER\\s+[^%]*name:${escapedName}[^%]*%>)[\\s\\S]*?(<%#\\s*\\/PLACEHOLDER\\s*%>)`,
            'g'
        );

        // Sostituisci mantenendo i tag di apertura e chiusura
        updatedContent = updatedContent.replace(regex, `$1\n${newValue}\n$2`);
    }

    return updatedContent;
}

/**
 * Genera il commento metadata per una pagina generata
 * @param {string} themeName - Nome del tema
 * @param {string} templatePath - Path relativo del template
 * @param {Date} createdDate - Data di creazione (opzionale)
 * @returns {string} Commento EJS formattato
 */
function generatePageMetadata(themeName, templatePath, createdDate = new Date()) {
    const created = createdDate.toISOString();
    const modified = created; // Alla creazione coincidono

    return `<%#
  ital8cms Page Metadata
  Theme: ${themeName}
  Template: ${templatePath}
  Created: ${created}
  Last modified: ${modified}
%>\n`;
}

/**
 * Aggiorna il timestamp di modifica nel metadata di una pagina
 * @param {string} content - Contenuto della pagina
 * @returns {string} Contenuto con timestamp aggiornato
 */
function updatePageMetadata(content) {
    const now = new Date().toISOString();

    // Regex per trovare e aggiornare "Last modified"
    const metadataRegex = /(Last modified:\s*)([^\n]+)/;

    if (metadataRegex.test(content)) {
        return content.replace(metadataRegex, `$1${now}`);
    }

    // Se non trova il metadata, ritorna il contenuto invariato
    // (in questo caso la pagina non ha metadata, non lo aggiungiamo in modifica)
    return content;
}

/**
 * Estrae il nome del tema dal metadata della pagina
 * @param {string} content - Contenuto della pagina
 * @returns {string|null} Nome del tema o null
 */
function extractThemeFromMetadata(content) {
    const themeRegex = /Theme:\s*([^\n]+)/;
    const match = content.match(themeRegex);
    return match ? match[1].trim() : null;
}

/**
 * Estrae il path del template dal metadata della pagina
 * @param {string} content - Contenuto della pagina
 * @returns {string|null} Path del template o null
 */
function extractTemplateFromMetadata(content) {
    const templateRegex = /Template:\s*([^\n]+)/;
    const match = content.match(templateRegex);
    return match ? match[1].trim() : null;
}

/**
 * Ottiene informazioni sul tema attivo e template disponibili
 * @returns {object} Oggetto con informazioni tema e template
 */
function getThemeInfo() {
    try {
        // Leggi configurazione principale
        const ital8Config = loadJson5(path.join(__dirname, '../../ital8Config.json'));
        const activeTheme = ital8Config.activeTheme;

        // Leggi configurazione tema
        const themePath = path.join(__dirname, '../../themes', activeTheme);
        const themeConfigPath = path.join(themePath, 'themeConfig.json');

        if (!fs.existsSync(themeConfigPath)) {
            return {
                success: false,
                error: `themeConfig.json non trovato per tema ${activeTheme}`
            };
        }

        const themeConfig = loadJson5(themeConfigPath);

        // Determina path www
        const wwwCustomPath = themeConfig.wwwCustomPath || 0;
        let wwwPath;
        let wwwPathType;

        if (wwwCustomPath === 1) {
            wwwPath = path.join(themePath, 'www');
            wwwPathType = 'custom';
        } else {
            wwwPath = path.join(__dirname, '../../www');
            wwwPathType = 'standard';
        }

        // Cerca template disponibili nel tema
        const templatesPath = path.join(themePath, 'templates');
        let templates = [];

        if (fs.existsSync(templatesPath)) {
            const files = fs.readdirSync(templatesPath);
            templates = files
                .filter(file => file.endsWith('.template.ejs'))
                .map(file => {
                    const templatePath = path.join(templatesPath, file);
                    const stat = fs.statSync(templatePath);

                    // Nome template senza estensione .template.ejs
                    const templateName = file.replace('.template.ejs', '');

                    return {
                        filename: file,
                        name: templateName,
                        displayName: templateName.charAt(0).toUpperCase() + templateName.slice(1),
                        path: templatePath,
                        size: stat.size,
                        modified: stat.mtime
                    };
                });
        }

        // Leggi descrizione tema se esiste
        const themeDescPath = path.join(themePath, 'themeDescription.json');
        let themeDescription = null;

        if (fs.existsSync(themeDescPath)) {
            themeDescription = loadJson5(themeDescPath);
        }

        return {
            success: true,
            theme: {
                name: activeTheme,
                description: themeDescription,
                config: {
                    wwwCustomPath: wwwCustomPath,
                    wwwPathType: wwwPathType,
                    isAdminTheme: themeConfig.isAdminTheme || false
                },
                paths: {
                    themePath: themePath,
                    wwwPath: wwwPath,
                    templatesPath: templatesPath
                }
            },
            templates: templates,
            templatesCount: templates.length
        };

    } catch (error) {
        console.error('[pagesManagment] Errore in getThemeInfo:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Genera le route API per la gestione delle pagine
 * @returns {Array} Array di oggetti route per Koa
 */
function getRoutes() {
    return [
        // GET /api/admin/pages - Lista tutte le pagine
        {
            method: 'GET',
            path: `/pages`,
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
            path: `/pages/detail`,
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
            path: `/pages/create`,
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
            path: `/pages/update`,
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
            path: `/pages/delete`,
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
            path: `/pages/createFolder`,
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
            path: `/pages/deleteFolder`,
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
        },

        // GET /api/admin/pages/info - Informazioni tema attivo e template disponibili
        {
            method: 'GET',
            path: `/pages/info`,
            handler: async (ctx) => {
                try {
                    const result = getThemeInfo();

                    if (result.success) {
                        ctx.body = result;
                    } else {
                        ctx.status = 500;
                        ctx.body = result;
                    }
                } catch (error) {
                    console.error('[pagesManagment] Errore GET /pages/info:', error);
                    ctx.status = 500;
                    ctx.body = {
                        success: false,
                        error: error.message
                    };
                }
            }
        },

        // GET /api/admin/pages/parseTemplate - Analizza un template e ritorna i campi placeholder
        {
            method: 'GET',
            path: `/pages/parseTemplate`,
            handler: async (ctx) => {
                try {
                    const { template, theme } = ctx.query;

                    if (!template || !theme) {
                        ctx.status = 400;
                        ctx.body = {
                            success: false,
                            error: 'Parametri template e theme richiesti'
                        };
                        return;
                    }

                    // Costruisci path completo del template
                    const themesBasePath = path.join(__dirname, '../../themes');
                    const templateFullPath = path.join(themesBasePath, theme, 'templates', template);

                    // Verifica esistenza template
                    if (!fs.existsSync(templateFullPath)) {
                        ctx.status = 404;
                        ctx.body = {
                            success: false,
                            error: `Template non trovato: ${theme}/templates/${template}`
                        };
                        return;
                    }

                    // Leggi il template
                    const templateContent = fs.readFileSync(templateFullPath, 'utf8');

                    // Estrai i placeholder
                    const placeholders = extractPlaceholders(templateContent);

                    ctx.body = {
                        success: true,
                        theme: theme,
                        template: template,
                        templatePath: `templates/${template}`,
                        placeholders: placeholders,
                        placeholdersCount: placeholders.length
                    };

                } catch (error) {
                    console.error('[pagesManagment] Errore GET /pages/parseTemplate:', error);
                    ctx.status = 500;
                    ctx.body = {
                        success: false,
                        error: 'Errore durante il parsing del template',
                        details: error.message
                    };
                }
            }
        },

        // GET /api/admin/pages/parsePage - Analizza una pagina esistente ed estrae placeholder e valori correnti
        {
            method: 'GET',
            path: `/pages/parsePage`,
            handler: async (ctx) => {
                try {
                    const { path: pagePath } = ctx.query;

                    if (!pagePath) {
                        ctx.status = 400;
                        ctx.body = {
                            success: false,
                            error: 'Parametro path richiesto'
                        };
                        return;
                    }

                    // Costruisci path completo
                    const wwwPath = getWwwPath();
                    const pageFullPath = path.join(wwwPath, pagePath);

                    // Verifica esistenza pagina
                    if (!fs.existsSync(pageFullPath)) {
                        ctx.status = 404;
                        ctx.body = {
                            success: false,
                            error: `Pagina non trovata: ${pagePath}`
                        };
                        return;
                    }

                    // Leggi il contenuto
                    const pageContent = fs.readFileSync(pageFullPath, 'utf8');

                    // Estrai metadata
                    const themeName = extractThemeFromMetadata(pageContent);
                    const templatePath = extractTemplateFromMetadata(pageContent);

                    // Estrai i placeholder con i loro valori CORRENTI
                    const placeholders = extractPlaceholders(pageContent);

                    // Costruisci oggetto values con i contenuti attuali
                    const currentValues = {};
                    placeholders.forEach(ph => {
                        currentValues[ph.name] = ph.defaultContent.trim();
                    });

                    ctx.body = {
                        success: true,
                        pagePath: pagePath,
                        theme: themeName,
                        template: templatePath,
                        placeholders: placeholders,
                        currentValues: currentValues,
                        placeholdersCount: placeholders.length
                    };

                } catch (error) {
                    console.error('[pagesManagment] Errore GET /pages/parsePage:', error);
                    ctx.status = 500;
                    ctx.body = {
                        success: false,
                        error: 'Errore durante il parsing della pagina',
                        details: error.message
                    };
                }
            }
        },

        // POST /api/admin/pages/createFromTemplate - Crea una nuova pagina da template con placeholder
        {
            method: 'POST',
            path: `/pages/createFromTemplate`,
            handler: async (ctx) => {
                try {
                    const { theme, template, pagePath, placeholderValues } = ctx.request.body;

                    // Validazione parametri
                    if (!theme || !template || !pagePath || !placeholderValues) {
                        ctx.status = 400;
                        ctx.body = {
                            success: false,
                            error: 'Parametri theme, template, pagePath e placeholderValues richiesti'
                        };
                        return;
                    }

                    // Valida formato path (deve finire con .ejs)
                    if (!pagePath.endsWith('.ejs')) {
                        ctx.status = 400;
                        ctx.body = {
                            success: false,
                            error: 'Il path deve terminare con .ejs'
                        };
                        return;
                    }

                    // Validazione sicurezza
                    if (!isPathSafe(pagePath)) {
                        ctx.status = 400;
                        ctx.body = {
                            success: false,
                            error: 'Path non valido o fuori dalla directory www'
                        };
                        return;
                    }

                    // Costruisci path completo destinazione
                    const wwwPath = getWwwPath();
                    const pageFullPath = path.join(wwwPath, pagePath);

                    // Verifica che la pagina non esista già
                    if (fs.existsSync(pageFullPath)) {
                        ctx.status = 409;
                        ctx.body = {
                            success: false,
                            error: `La pagina ${pagePath} esiste già`
                        };
                        return;
                    }

                    // Leggi il template
                    const themesBasePath = path.join(__dirname, '../../themes');
                    const templateFullPath = path.join(themesBasePath, theme, 'templates', template);

                    if (!fs.existsSync(templateFullPath)) {
                        ctx.status = 404;
                        ctx.body = {
                            success: false,
                            error: `Template non trovato: ${theme}/templates/${template}`
                        };
                        return;
                    }

                    let templateContent = fs.readFileSync(templateFullPath, 'utf8');

                    // Sostituisci i placeholder con i valori forniti
                    const pageContent = replacePlaceholderContent(templateContent, placeholderValues);

                    // Aggiungi metadata all'inizio
                    const metadata = generatePageMetadata(theme, `templates/${template}`);
                    const finalContent = metadata + pageContent;

                    // Crea le directory intermedie se necessario
                    const pageDir = path.dirname(pageFullPath);
                    if (!fs.existsSync(pageDir)) {
                        fs.mkdirSync(pageDir, { recursive: true });
                    }

                    // Scrivi il file (atomic write)
                    const tempPath = pageFullPath + '.tmp';
                    fs.writeFileSync(tempPath, finalContent, 'utf8');
                    fs.renameSync(tempPath, pageFullPath);

                    ctx.body = {
                        success: true,
                        message: `Pagina ${pagePath} creata con successo`,
                        pagePath: pagePath,
                        fullPath: pageFullPath
                    };

                } catch (error) {
                    console.error('[pagesManagment] Errore POST /pages/createFromTemplate:', error);
                    ctx.status = 500;
                    ctx.body = {
                        success: false,
                        error: 'Errore durante la creazione della pagina',
                        details: error.message
                    };
                }
            }
        },

        // POST /api/admin/pages/updateWithPlaceholders - Aggiorna una pagina esistente mantenendo i tag PLACEHOLDER
        {
            method: 'POST',
            path: `/pages/updateWithPlaceholders`,
            handler: async (ctx) => {
                try {
                    const { pagePath, placeholderValues } = ctx.request.body;

                    // Validazione parametri
                    if (!pagePath || !placeholderValues) {
                        ctx.status = 400;
                        ctx.body = {
                            success: false,
                            error: 'Parametri pagePath e placeholderValues richiesti'
                        };
                        return;
                    }

                    // Validazione sicurezza
                    if (!isPathSafe(pagePath)) {
                        ctx.status = 400;
                        ctx.body = {
                            success: false,
                            error: 'Path non valido o fuori dalla directory www'
                        };
                        return;
                    }

                    // Costruisci path completo
                    const wwwPath = getWwwPath();
                    const pageFullPath = path.join(wwwPath, pagePath);

                    // Verifica esistenza pagina
                    if (!fs.existsSync(pageFullPath)) {
                        ctx.status = 404;
                        ctx.body = {
                            success: false,
                            error: `Pagina non trovata: ${pagePath}`
                        };
                        return;
                    }

                    // Leggi il contenuto corrente
                    let pageContent = fs.readFileSync(pageFullPath, 'utf8');

                    // Sostituisci i placeholder con i nuovi valori
                    pageContent = replacePlaceholderContent(pageContent, placeholderValues);

                    // Aggiorna il timestamp di modifica nel metadata
                    pageContent = updatePageMetadata(pageContent);

                    // Scrivi il file aggiornato (atomic write)
                    const tempPath = pageFullPath + '.tmp';
                    fs.writeFileSync(tempPath, pageContent, 'utf8');
                    fs.renameSync(tempPath, pageFullPath);

                    ctx.body = {
                        success: true,
                        message: `Pagina ${pagePath} aggiornata con successo`,
                        pagePath: pagePath
                    };

                } catch (error) {
                    console.error('[pagesManagment] Errore POST /pages/updateWithPlaceholders:', error);
                    ctx.status = 500;
                    ctx.body = {
                        success: false,
                        error: 'Errore durante l\'aggiornamento della pagina',
                        details: error.message
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
    getThemeInfo,
    getRoutes
};
