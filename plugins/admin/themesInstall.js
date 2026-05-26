/**
 * MODULO INSTALLAZIONE TEMA DA REPO GIT REMOTO
 *
 * Installa un tema ital8cms clonando un repository Git pubblico.
 *
 * Vincolo naming: il repository remoto DEVE avere un nome che inizia con
 * il prefisso configurato in `pluginConfig.json5` (default: "ital8cms-theme-").
 * Lo stesso prefisso vale per temi public e admin: il tipo è dichiarato
 * esclusivamente dal campo `isAdminTheme` del `themeConfig.json5` clonato.
 *
 * Nome cartella tema: la parte del nome repo dopo il prefisso viene convertita
 * da kebab-case a camelCase.
 *   "ital8cms-theme-foo"            -> dir themes/foo/
 *   "ital8cms-theme-my-cool-theme"  -> dir themes/myCoolTheme/
 *   "ital8cms-theme-admin-foo"      -> dir themes/adminFoo/
 *
 * Post-installazione il tema viene SEMPRE lasciato disattivato e marcato come
 * non installato (`active: 0`, `isInstalled: 0`). L'attivazione manuale è
 * responsabilità dell'amministratore tramite la pagina di gestione temi.
 *
 * Collisione su `themes/<nome>/` esistente:
 *   - default: 409 con `{conflict: true, existingTheme: {...}}`, nessun job.
 *   - con `confirmOverwrite: true` nel body: la dir esistente viene rimossa
 *     prima del clone (fase `overwriteExisting`). Il rollback in caso di
 *     errore post-clone NON ripristina il tema precedente.
 *
 * Flusso (fasi):
 *   1. Parse e validazione URL, estrazione nome tema
 *   2. Check destinazione (con eventuale overwrite previa conferma)
 *   3. Clone via `git clone`
 *   4. Validazione file richiesti, parsing JSON5, lettura `isAdminTheme`
 *   5. Forzatura `active: 0`, `isInstalled: 0`, scrittura `themeConfig.json5`
 *   6. Audit log
 *
 * Su QUALUNQUE fallimento dopo lo step 3 (clone riuscito) la cartella appena
 * creata viene rimossa per non lasciare uno stato sporco.
 *
 * I job sono asincroni: il client riceve subito un installId e fa polling
 * sull'endpoint di stato. Lo stato vive in una Map in memoria (FIFO eviction).
 *
 * Il lock `isInstallingTheme` è separato da quello di `pluginsInstall`, quindi
 * un'installazione tema e una plugin possono procedere in parallelo, ma due
 * installazioni tema concorrenti vengono serializzate.
 *
 * ROUTE ESPOSTE (verranno prefissate con `/api/admin/`):
 *   POST /themes/install                       avvia un'installazione tema
 *   GET  /themes/install/:installId/status     stato di un job
 *
 * NOTA: non viene esposto un endpoint `restart-info` né `restart` dedicato:
 * il tema viene installato disattivato, quindi non è necessario riavviare
 * subito. L'eventuale restart è gestito dal modulo `pluginsInstall` (endpoint
 * condiviso `POST /api/admin/restart`).
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const loadJson5 = require('../../core/loadJson5');

// ----- COSTANTI / PATH -------------------------------------------------------

const ADMIN_PLUGIN_DIR = __dirname;
const THEMES_PATH = path.join(ADMIN_PLUGIN_DIR, '../../themes');
const AUDIT_LOG_PATH = path.join(ADMIN_PLUGIN_DIR, 'themeInstallLog.json5');

const JOB_STATUS = Object.freeze({
    PENDING: 'pending',
    RUNNING: 'running',
    SUCCESS: 'success',
    FAILED: 'failed',
});

// ----- STATE STORE -----------------------------------------------------------

const installJobs = new Map();
let isInstallingTheme = false;

function loadInstallConfig() {
    const adminConfig = loadJson5(path.join(ADMIN_PLUGIN_DIR, 'pluginConfig.json5'));
    return (adminConfig.custom && adminConfig.custom.themesInstall) || {};
}

// Legge debugMode da ital8Config.json5. Usato per gating del dry-run:
// il dry-run è uno strumento di diagnostica per testare la UI senza
// dipendere da rete o repository esterni, quindi viene esposto solo
// quando il sistema è in modalità debug.
function isDryRunEnabled() {
    try {
        const projectRoot = path.resolve(__dirname, '..', '..');
        const ital8Conf = loadJson5(path.join(projectRoot, 'ital8Config.json5'));
        return Number(ital8Conf.debugMode || 0) >= 1;
    } catch (e) {
        return false;
    }
}

function pruneJobHistory(maxJobHistory) {
    if (installJobs.size <= maxJobHistory) return;
    const overflow = installJobs.size - maxJobHistory;
    const keys = installJobs.keys();
    for (let i = 0; i < overflow; i++) {
        const key = keys.next().value;
        const job = installJobs.get(key);
        if (job && (job.status === JOB_STATUS.PENDING || job.status === JOB_STATUS.RUNNING)) {
            continue;
        }
        installJobs.delete(key);
    }
}

function newInstallId() {
    return `tinst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function snapshotJob(job) {
    return {
        installId: job.installId,
        status: job.status,
        repoUrl: job.repoUrl,
        branchOrTag: job.branchOrTag || null,
        themeName: job.themeName || null,
        isAdminTheme: typeof job.isAdminTheme === 'boolean' ? job.isAdminTheme : null,
        confirmOverwrite: !!job.confirmOverwrite,
        phases: job.phases.slice(),
        currentPhase: job.currentPhase || null,
        error: job.error || null,
        warnings: job.warnings.slice(),
        result: job.result || null,
        progress: job.progress || null,
        progressHistory: job.progressHistory ? job.progressHistory.slice() : [],
        startedAt: job.startedAt,
        finishedAt: job.finishedAt || null,
    };
}

// ----- PURE VALIDATORS -------------------------------------------------------

const URL_REGEX = /^https:\/\/[^\s]+\.git$/i;

function validateRepoUrl(repoUrl) {
    if (typeof repoUrl !== 'string' || !repoUrl.trim()) {
        return { ok: false, error: 'URL del repository mancante.' };
    }
    const trimmed = repoUrl.trim();
    if (!URL_REGEX.test(trimmed)) {
        return {
            ok: false,
            error: 'URL non valido: deve essere HTTPS e terminare con ".git".',
        };
    }
    return { ok: true, value: trimmed };
}

// Converte una stringa kebab-case in camelCase.
// "foo"              -> "foo"
// "my-cool-theme"    -> "myCoolTheme"
// "admin-foo"        -> "adminFoo"
// "admin-my-foo"     -> "adminMyFoo"
function kebabToCamel(input) {
    return input.replace(/-([a-zA-Z0-9])/g, (_, ch) => ch.toUpperCase());
}

function extractThemeNameFromUrl(repoUrl, repoPrefix) {
    let lastSegment;
    try {
        const parsed = new URL(repoUrl);
        const segments = parsed.pathname.split('/').filter(Boolean);
        lastSegment = segments[segments.length - 1] || '';
    } catch (e) {
        return { ok: false, error: 'URL non parsificabile.' };
    }
    if (!lastSegment.toLowerCase().endsWith('.git')) {
        return { ok: false, error: 'URL non valido: il path deve terminare con ".git".' };
    }
    const repoName = lastSegment.slice(0, -4);
    if (!repoName.startsWith(repoPrefix)) {
        return {
            ok: false,
            error: `Nome repo "${repoName}" non valido: deve iniziare con "${repoPrefix}".`,
        };
    }
    const rawSegment = repoName.slice(repoPrefix.length);
    if (!rawSegment) {
        return {
            ok: false,
            error: `Nome tema vuoto: il repo deve essere "${repoPrefix}<nomeTema>".`,
        };
    }

    // Validazione caratteri raw segment: solo lettere, cifre, '-' e '_'.
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(rawSegment)) {
        return {
            ok: false,
            error: `Nome repo "${rawSegment}" non valido: deve iniziare con una lettera e contenere solo lettere, cifre, "_" e "-".`,
        };
    }

    const themeName = kebabToCamel(rawSegment);
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(themeName)) {
        // Sicurezza ulteriore: dopo la conversione restano solo lettere/cifre.
        return {
            ok: false,
            error: `Nome tema "${themeName}" non valido dopo conversione camelCase.`,
        };
    }

    return {
        ok: true,
        value: {
            themeName,
            rawSegment,
        },
    };
}

function validateBranchOrTag(branchOrTag) {
    if (branchOrTag === undefined || branchOrTag === null || branchOrTag === '') {
        return { ok: true, value: null };
    }
    if (typeof branchOrTag !== 'string') {
        return { ok: false, error: 'Branch/Tag non valido.' };
    }
    const trimmed = branchOrTag.trim();
    if (!trimmed) {
        return { ok: true, value: null };
    }
    if (!/^[A-Za-z0-9._\/\-]+$/.test(trimmed) || trimmed.startsWith('-')) {
        return {
            ok: false,
            error: 'Branch/Tag non valido: ammessi lettere, cifre, ".", "_", "/", "-".',
        };
    }
    return { ok: true, value: trimmed };
}

// ----- FILESYSTEM HELPERS ----------------------------------------------------

function targetThemeDir(themeName) {
    return path.join(THEMES_PATH, themeName);
}

function themeDirExists(themeName) {
    return fs.existsSync(targetThemeDir(themeName));
}

function rollbackThemeDir(themeName) {
    const dir = targetThemeDir(themeName);
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// Legge i metadati di un tema già presente in themes/<themeName>/.
// Usato per popolare il dialog di conferma sovrascrittura: l'utente vede
// cosa sta per essere distrutto. Se la dir esiste ma non sembra un tema
// valido (file mancanti o non parsificabili) ritorna { invalid: true }.
function readExistingThemeMetadata(themeName) {
    const dir = targetThemeDir(themeName);
    const configPath = path.join(dir, 'themeConfig.json5');
    const descriptionPath = path.join(dir, 'themeDescription.json5');

    if (!fs.existsSync(configPath) || !fs.existsSync(descriptionPath)) {
        return { invalid: true, reason: 'file di configurazione assenti' };
    }
    let config, description;
    try {
        config = loadJson5(configPath);
        description = loadJson5(descriptionPath);
    } catch (e) {
        return { invalid: true, reason: 'file di configurazione non parsificabili' };
    }
    return {
        themeName,
        name: description.name || null,
        version: description.version || null,
        author: description.author || null,
        license: description.license || null,
        isAdminTheme: typeof config.isAdminTheme === 'boolean' ? config.isAdminTheme : null,
        active: config.active === 1,
        isInstalled: config.isInstalled === 1,
    };
}

function writeJson5Atomic(filePath, dataObj, headerComment) {
    const header = headerComment || '// This file follows the JSON5 standard - comments and trailing commas are supported';
    const content = `${header}\n${JSON.stringify(dataObj, null, 2)}\n`;
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, filePath);
}

// ----- GIT CLONE -------------------------------------------------------------

// Parser delle righe di progress emesse da `git clone --progress` su stderr.
// Riconosce tre stadi: 'receiving' (download oggetti), 'resolving' (risoluzione
// delta) e 'updatingFiles' (checkout dei file sul working tree).
// Ritorna null se la riga non è un progress riconosciuto.
function parseGitProgressLine(line) {
    if (typeof line !== 'string') return null;

    // Receiving objects:  45% (123/270), 1.20 MiB | 800.00 KiB/s
    let m = line.match(/Receiving objects:\s+(\d+)%\s+\((\d+)\/(\d+)\)(?:,\s+([\d.]+\s+[KMGT]?i?B))?(?:\s*\|\s*([\d.]+\s+[KMGT]?i?B\/s))?/);
    if (m) {
        return {
            stage: 'receiving',
            percent: parseInt(m[1], 10),
            current: parseInt(m[2], 10),
            total: parseInt(m[3], 10),
            bytes: m[4] || null,
            rate: m[5] || null,
        };
    }

    // Resolving deltas:  60% (50/83)
    m = line.match(/Resolving deltas:\s+(\d+)%\s+\((\d+)\/(\d+)\)/);
    if (m) {
        return {
            stage: 'resolving',
            percent: parseInt(m[1], 10),
            current: parseInt(m[2], 10),
            total: parseInt(m[3], 10),
            bytes: null,
            rate: null,
        };
    }

    // Updating files:  80% (40/50)
    m = line.match(/Updating files:\s+(\d+)%\s+\((\d+)\/(\d+)\)/);
    if (m) {
        return {
            stage: 'updatingFiles',
            percent: parseInt(m[1], 10),
            current: parseInt(m[2], 10),
            total: parseInt(m[3], 10),
            bytes: null,
            rate: null,
        };
    }

    return null;
}

function runGitClone({ repoUrl, branchOrTag, destDir, timeoutMs, onProgress }) {
    return new Promise((resolve) => {
        // `--progress` forza l'emissione dei progress su stderr anche senza TTY.
        const args = ['clone', '--progress', '--depth', '1'];
        if (branchOrTag) {
            args.push('--branch', branchOrTag);
        }
        args.push('--', repoUrl, destDir);

        const env = Object.assign({}, process.env, {
            GIT_TERMINAL_PROMPT: '0',
            GIT_ASKPASS: 'echo',
        });

        let stderrBuf = '';
        let stdoutBuf = '';
        let partialLine = '';
        let timedOut = false;

        const child = spawn('git', args, { env });

        const killer = setTimeout(() => {
            timedOut = true;
            try { child.kill('SIGKILL'); } catch (e) { /* noop */ }
        }, timeoutMs);

        child.stdout.on('data', (d) => { stdoutBuf += d.toString(); });

        child.stderr.on('data', (d) => {
            const chunk = d.toString();
            stderrBuf += chunk;

            if (typeof onProgress !== 'function') return;

            // git separa gli update di progress con '\r' (overwrite della stessa
            // riga di terminale) e le righe finali con '\n'. Split su entrambi.
            const tokens = (partialLine + chunk).split(/[\r\n]+/);
            partialLine = tokens.pop() || '';
            for (const token of tokens) {
                if (!token) continue;
                const ev = parseGitProgressLine(token);
                if (ev) {
                    try { onProgress(ev); } catch (e) { /* noop: callback safety */ }
                }
            }
        });

        child.on('error', (err) => {
            clearTimeout(killer);
            resolve({ ok: false, error: `Impossibile eseguire git: ${err.message}`, stderr: stderrBuf });
        });

        child.on('close', (code) => {
            clearTimeout(killer);
            // Flush eventuale ultima riga rimasta nel buffer.
            if (partialLine && typeof onProgress === 'function') {
                const ev = parseGitProgressLine(partialLine);
                if (ev) {
                    try { onProgress(ev); } catch (e) { /* noop */ }
                }
                partialLine = '';
            }
            if (timedOut) {
                resolve({ ok: false, error: 'Timeout durante il clone del repository.', stderr: stderrBuf });
                return;
            }
            if (code !== 0) {
                resolve({ ok: false, error: `git clone ha terminato con codice ${code}.`, stderr: stderrBuf, stdout: stdoutBuf });
                return;
            }
            resolve({ ok: true, stderr: stderrBuf, stdout: stdoutBuf });
        });
    });
}

// ----- POST-CLONE VALIDATION -------------------------------------------------

function validateClonedTheme(themeDir, expectedThemeName) {
    const warnings = [];

    const configPath = path.join(themeDir, 'themeConfig.json5');
    const descriptionPath = path.join(themeDir, 'themeDescription.json5');
    const viewsDir = path.join(themeDir, 'views');
    const headPath = path.join(viewsDir, 'head.ejs');
    const footerPath = path.join(viewsDir, 'footer.ejs');

    const missingFiles = [];
    if (!fs.existsSync(configPath)) missingFiles.push('themeConfig.json5');
    if (!fs.existsSync(descriptionPath)) missingFiles.push('themeDescription.json5');
    if (!fs.existsSync(viewsDir) || !fs.statSync(viewsDir).isDirectory()) missingFiles.push('views/');
    if (!fs.existsSync(headPath)) missingFiles.push('views/head.ejs');
    if (!fs.existsSync(footerPath)) missingFiles.push('views/footer.ejs');

    if (missingFiles.length > 0) {
        return {
            ok: false,
            error: `Struttura tema non valida: file/cartelle mancanti -> ${missingFiles.join(', ')}.`,
        };
    }

    let config;
    let description;
    try {
        config = loadJson5(configPath);
    } catch (e) {
        return { ok: false, error: `themeConfig.json5 non parsificabile: ${e.message}` };
    }
    try {
        description = loadJson5(descriptionPath);
    } catch (e) {
        return { ok: false, error: `themeDescription.json5 non parsificabile: ${e.message}` };
    }

    if (!description.name || typeof description.name !== 'string') {
        return { ok: false, error: 'Campo "name" mancante o non stringa in themeDescription.json5.' };
    }
    if (description.name !== expectedThemeName) {
        return {
            ok: false,
            error: `Nome tema incongruente: il repo implica "${expectedThemeName}" ma themeDescription.json5 dichiara "${description.name}".`,
        };
    }

    // Il flag isAdminTheme è obbligatorio e dichiarato esclusivamente nel
    // themeConfig.json5; non c'è più alcun cross-check vs URL.
    if (typeof config.isAdminTheme !== 'boolean') {
        return {
            ok: false,
            error: 'themeConfig.json5: il campo "isAdminTheme" è obbligatorio e deve essere booleano (true/false).',
        };
    }

    return {
        ok: true,
        value: {
            config,
            description,
            configPath,
            isAdminTheme: config.isAdminTheme,
            warnings,
        },
    };
}

// ----- WRITE FINAL CONFIG ----------------------------------------------------

// Forza il tema a stato disattivato e non-installato, indipendentemente da
// quanto dichiarato nel repo. L'attivazione è responsabilità dell'admin.
function finalizeThemeConfig({ configPath, config }) {
    const updated = Object.assign({}, config);
    updated.active = 0;
    updated.isInstalled = 0;
    writeJson5Atomic(configPath, updated);
    return updated;
}

// ----- AUDIT LOG -------------------------------------------------------------

function appendAuditLog(entry) {
    let logData;
    try {
        if (fs.existsSync(AUDIT_LOG_PATH)) {
            logData = loadJson5(AUDIT_LOG_PATH);
        } else {
            logData = { entries: [] };
        }
    } catch (e) {
        logData = { entries: [] };
    }
    if (!Array.isArray(logData.entries)) logData.entries = [];
    logData.entries.push(entry);
    try {
        writeJson5Atomic(AUDIT_LOG_PATH, logData);
    } catch (e) {
        console.error('[themesInstall] Impossibile scrivere audit log:', e.message);
    }
}

// ----- JOB RUNNER ------------------------------------------------------------

function pushPhase(job, name, ok, detail) {
    job.phases.push({
        name,
        ok: !!ok,
        detail: detail || null,
        at: new Date().toISOString(),
    });
    job.currentPhase = name;
}

async function runInstall(job, installConfig) {
    job.status = JOB_STATUS.RUNNING;
    const auditBase = {
        installId: job.installId,
        repoUrl: job.repoUrl,
        branchOrTag: job.branchOrTag,
        startedAt: job.startedAt,
        user: job.user || null,
    };

    let createdDir = false;

    try {
        // FASE 1 - URL parsing già fatto in handler; qui usiamo i valori già validati.
        pushPhase(job, 'parseUrl', true, `Theme name: "${job.themeName}"`);

        // FASE 2 - check destinazione. La presenza della dir esistente con
        // conferma è già stata gestita dall'handler; qui o la dir non esiste
        // più (overwrite consentito già rimosso poco sopra) o gestiamo il
        // caso edge in cui sia ricomparsa tra check ed esecuzione del job.
        if (themeDirExists(job.themeName)) {
            if (!job.confirmOverwrite) {
                throw new Error(`La cartella themes/${job.themeName} esiste già. Operazione interrotta.`);
            }
            try {
                rollbackThemeDir(job.themeName);
            } catch (e) {
                throw new Error(`Impossibile rimuovere la cartella esistente themes/${job.themeName}: ${e.message}`);
            }
            pushPhase(job, 'overwriteExisting', true, 'Tema preesistente rimosso (sovrascrittura confermata).');
        }
        pushPhase(job, 'checkDestination', true);

        // FASE 3 - clone
        pushPhase(job, 'cloneStart', true, job.branchOrTag ? `branch/tag: ${job.branchOrTag}` : 'default branch');

        // Throttle progress: max 1 update ogni 200ms. Cambio stage e percent===100
        // bypassano il throttle per non perdere transizioni e completamenti.
        const THROTTLE_MS = 200;
        const HISTORY_CAP = 500;
        let lastEmitMs = 0;
        let lastStage = null;
        const onProgress = (ev) => {
            const now = Date.now();
            const stageChanged = ev.stage !== lastStage;
            const isComplete = ev.percent === 100;
            if (!stageChanged && !isComplete && (now - lastEmitMs) < THROTTLE_MS) {
                return;
            }
            lastEmitMs = now;
            lastStage = ev.stage;
            const snapshot = Object.assign({}, ev, { at: new Date(now).toISOString() });
            job.progress = snapshot;
            job.progressHistory.push(snapshot);
            if (job.progressHistory.length > HISTORY_CAP) {
                // Drop dei più vecchi mantenendo gli ultimi HISTORY_CAP.
                job.progressHistory.splice(0, job.progressHistory.length - HISTORY_CAP);
            }
        };

        const cloneRes = await runGitClone({
            repoUrl: job.repoUrl,
            branchOrTag: job.branchOrTag,
            destDir: targetThemeDir(job.themeName),
            timeoutMs: installConfig.cloneTimeoutMs || 120000,
            onProgress,
        });
        if (!cloneRes.ok) {
            const detail = installConfig.exposeGitErrors && cloneRes.stderr
                ? `${cloneRes.error}\n--- git stderr ---\n${cloneRes.stderr.trim()}`
                : cloneRes.error;
            throw new Error(detail);
        }
        createdDir = true;
        pushPhase(job, 'cloneDone', true);

        // FASE 4 - validazione
        const valRes = validateClonedTheme(targetThemeDir(job.themeName), job.themeName);
        if (!valRes.ok) {
            throw new Error(valRes.error);
        }
        // Il flag admin viene letto dal config clonato e propagato sul job.
        job.isAdminTheme = valRes.value.isAdminTheme;
        pushPhase(job, 'validate', true, `isAdminTheme=${job.isAdminTheme}`);
        valRes.value.warnings.forEach(w => job.warnings.push(w));

        // FASE 5 - scrittura config finale (sempre disattivato)
        const finalConfig = finalizeThemeConfig({
            configPath: valRes.value.configPath,
            config: valRes.value.config,
        });
        pushPhase(job, 'finalizeConfig', true, `active=${finalConfig.active}, isInstalled=${finalConfig.isInstalled}`);

        // SUCCESS
        job.status = JOB_STATUS.SUCCESS;
        job.finishedAt = new Date().toISOString();
        job.result = {
            themeName: job.themeName,
            themePath: targetThemeDir(job.themeName),
            isAdminTheme: job.isAdminTheme,
            active: finalConfig.active === 1,
            isInstalled: finalConfig.isInstalled === 1,
            overwritten: !!job.confirmOverwrite,
            description: {
                name: valRes.value.description.name,
                version: valRes.value.description.version || null,
                author: valRes.value.description.author || null,
                license: valRes.value.description.license || null,
            },
            warnings: job.warnings.slice(),
        };

        appendAuditLog(Object.assign({}, auditBase, {
            outcome: 'success',
            themeName: job.themeName,
            isAdminTheme: job.isAdminTheme,
            overwritten: !!job.confirmOverwrite,
            finishedAt: job.finishedAt,
            warnings: job.warnings,
        }));

    } catch (err) {
        if (createdDir) {
            let rollbackOk = true;
            let rollbackErr = null;
            try {
                rollbackThemeDir(job.themeName);
            } catch (e) {
                rollbackOk = false;
                rollbackErr = e.message;
            }
            if (rollbackOk) {
                pushPhase(job, 'rollback', true, job.confirmOverwrite
                    ? 'Cartella appena clonata rimossa. Il tema preesistente NON è stato ripristinato.'
                    : 'Cartella rimossa.');
            } else {
                // Rollback fallito: i file restano su disco. È fondamentale che
                // l'utente sia avvisato perché altrimenti vedrebbe "failed" ma
                // troverebbe il tema sul filesystem (e potenzialmente funzionante),
                // generando confusione su quale sia lo stato reale.
                pushPhase(job, 'rollback', false,
                    `Rollback fallito: ${rollbackErr}. I file restano in themes/${job.themeName} — rimuoverli manualmente.`);
                job.warnings.push(
                    `Rollback fallito: la cartella themes/${job.themeName} non è stata rimossa (${rollbackErr}). ` +
                    `Verifica manualmente lo stato del filesystem prima di ritentare l'installazione.`
                );
            }
        }
        job.status = JOB_STATUS.FAILED;
        job.finishedAt = new Date().toISOString();
        job.error = err.message;

        appendAuditLog(Object.assign({}, auditBase, {
            outcome: 'failure',
            themeName: job.themeName || null,
            isAdminTheme: typeof job.isAdminTheme === 'boolean' ? job.isAdminTheme : null,
            overwritten: !!job.confirmOverwrite,
            finishedAt: job.finishedAt,
            error: err.message,
        }));
    } finally {
        isInstallingTheme = false;
        pruneJobHistory(installConfig.maxJobHistory || 50);
    }
}

// ----- DRY-RUN ---------------------------------------------------------------

// Simula un'installazione tema completa emettendo finti eventi di progress
// nello stesso formato del git clone reale. Utile per:
//   - testare visivamente la progress bar senza dover pushare un tema reale
//   - validare il client (UI, polling, rendering) end-to-end in isolamento
//   - debug rapido di modifiche all'EJS senza dipendenze esterne
//
// Disponibile SOLO con debugMode >= 1 in ital8Config.json5.
function runDryRunInstall(job, installConfig) {
    const totalDurationMs = Math.max(1000, Number(installConfig.dryRunDurationMs) || 5000);

    // Pesi delle fasi: receiving domina (~55%), seguito da updatingFiles (~30%),
    // resolving deltas è breve (~10%), il resto (5%) per validate/finalize.
    const receivingMs = totalDurationMs * 0.55;
    const resolvingMs = totalDurationMs * 0.10;
    const updatingMs  = totalDurationMs * 0.30;
    const tailMs      = totalDurationMs * 0.05;

    // Numeri plausibili per un tema di taglia media.
    const totalObjects = 250;
    const totalDeltas  = 80;
    const totalFiles   = 200;
    const totalBytes   = 5 * 1024 * 1024;

    const startedAt = Date.now();
    job.status = JOB_STATUS.RUNNING;

    const fmtBytes = (n) => {
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KiB`;
        return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
    };

    const emit = (ev) => {
        const snapshot = Object.assign({}, ev, { at: new Date().toISOString() });
        job.progress = snapshot;
        job.progressHistory.push(snapshot);
        if (job.progressHistory.length > 500) {
            job.progressHistory.splice(0, job.progressHistory.length - 500);
        }
    };

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    (async () => {
        try {
            pushPhase(job, 'lockAcquired', true, 'DRY-RUN: nessun lock reale acquisito');
            pushPhase(job, 'validateInput', true, 'DRY-RUN: input simulato');
            pushPhase(job, 'checkDestination', true, 'DRY-RUN: nessuna scrittura su disco');
            pushPhase(job, 'cloneStart', true, 'DRY-RUN: clone simulato');

            // Receiving objects (con bytes e rate crescenti, come git reale).
            const receivingSteps = 50;
            for (let i = 0; i <= receivingSteps; i++) {
                const percent = Math.round((i / receivingSteps) * 100);
                const current = Math.round((i / receivingSteps) * totalObjects);
                const bytesSent = Math.round((i / receivingSteps) * totalBytes);
                const elapsedSec = Math.max(0.001, (Date.now() - startedAt) / 1000);
                const rateBps = bytesSent / elapsedSec;
                emit({
                    stage: 'receiving',
                    percent,
                    current,
                    total: totalObjects,
                    bytes: fmtBytes(bytesSent),
                    rate: `${fmtBytes(rateBps)}/s`,
                });
                if (i < receivingSteps) await sleep(receivingMs / receivingSteps);
            }

            // Resolving deltas.
            const resolvingSteps = 10;
            for (let i = 0; i <= resolvingSteps; i++) {
                emit({
                    stage: 'resolving',
                    percent: Math.round((i / resolvingSteps) * 100),
                    current: Math.round((i / resolvingSteps) * totalDeltas),
                    total: totalDeltas,
                    bytes: null,
                    rate: null,
                });
                if (i < resolvingSteps) await sleep(resolvingMs / resolvingSteps);
            }

            // Updating files (checkout).
            const updatingSteps = 40;
            for (let i = 0; i <= updatingSteps; i++) {
                emit({
                    stage: 'updatingFiles',
                    percent: Math.round((i / updatingSteps) * 100),
                    current: Math.round((i / updatingSteps) * totalFiles),
                    total: totalFiles,
                    bytes: null,
                    rate: null,
                });
                if (i < updatingSteps) await sleep(updatingMs / updatingSteps);
            }

            pushPhase(job, 'cloneDone', true, 'DRY-RUN');
            await sleep(tailMs / 3);
            pushPhase(job, 'validate', true, 'DRY-RUN: isAdminTheme=false');
            await sleep(tailMs / 3);
            pushPhase(job, 'finalizeConfig', true, 'DRY-RUN: active=0, isInstalled=0');
            await sleep(tailMs / 3);

            job.status = JOB_STATUS.SUCCESS;
            job.finishedAt = new Date().toISOString();
            job.result = {
                themeName: job.themeName,
                themePath: '(dry-run: nessun path reale)',
                isAdminTheme: false,
                active: false,
                isInstalled: false,
                overwritten: false,
                description: {
                    name: job.themeName,
                    version: '1.0.0-dryrun',
                    author: 'dry-run simulator',
                    license: 'N/A',
                },
                warnings: ['DRY-RUN: nessuna modifica reale al filesystem.'],
                dryRun: true,
            };
            job.warnings.push('Questo è un dry-run: nessun tema reale è stato installato.');
        } catch (err) {
            job.status = JOB_STATUS.FAILED;
            job.finishedAt = new Date().toISOString();
            job.error = `Errore durante dry-run: ${err.message}`;
        } finally {
            isInstallingTheme = false;
            pruneJobHistory(installConfig.maxJobHistory || 50);
        }
    })();
}

// ----- ROUTES ----------------------------------------------------------------

function getRoutes() {
    const routes = [];

    routes.push({
        method: 'POST',
        path: '/themes/install',
        access: { requiresAuth: true, allowedRoles: [0, 1] },
        handler: async (ctx) => {
            const installConfig = loadInstallConfig();
            const repoPrefix = installConfig.repoPrefix || 'ital8cms-theme-';

            if (isInstallingTheme) {
                ctx.status = 409;
                ctx.body = { success: false, error: 'Un\'altra installazione di tema è già in corso. Attendere il completamento.' };
                return;
            }

            const body = ctx.request.body || {};
            const confirmOverwrite = body.confirmOverwrite === true || body.confirmOverwrite === 1 || body.confirmOverwrite === '1';

            const urlV = validateRepoUrl(body.repoUrl);
            if (!urlV.ok) {
                ctx.status = 400;
                ctx.body = { success: false, error: urlV.error };
                return;
            }
            const branchV = validateBranchOrTag(body.branchOrTag);
            if (!branchV.ok) {
                ctx.status = 400;
                ctx.body = { success: false, error: branchV.error };
                return;
            }
            const nameV = extractThemeNameFromUrl(urlV.value, repoPrefix);
            if (!nameV.ok) {
                ctx.status = 400;
                ctx.body = { success: false, error: nameV.error };
                return;
            }

            // Collisione: senza confirmOverwrite restituiamo i metadati del
            // tema esistente in modo che la UI possa chiedere conferma. Non
            // creiamo job né acquisiamo il lock: il client dovrà riinviare
            // la POST con confirmOverwrite=true se vuole procedere.
            if (themeDirExists(nameV.value.themeName) && !confirmOverwrite) {
                ctx.status = 409;
                ctx.body = {
                    success: false,
                    conflict: true,
                    themeName: nameV.value.themeName,
                    existingTheme: readExistingThemeMetadata(nameV.value.themeName),
                    error: `La cartella themes/${nameV.value.themeName} esiste già.`,
                };
                return;
            }

            isInstallingTheme = true;
            const installId = newInstallId();
            const job = {
                installId,
                status: JOB_STATUS.PENDING,
                repoUrl: urlV.value,
                branchOrTag: branchV.value,
                themeName: nameV.value.themeName,
                // popolato in fase validate dopo lettura del themeConfig.json5
                isAdminTheme: null,
                confirmOverwrite,
                phases: [],
                currentPhase: null,
                warnings: [],
                error: null,
                result: null,
                progress: null,
                progressHistory: [],
                startedAt: new Date().toISOString(),
                finishedAt: null,
                user: ctx.session && ctx.session.user ? ctx.session.user.username : null,
            };
            installJobs.set(installId, job);

            setImmediate(() => {
                runInstall(job, installConfig).catch((e) => {
                    console.error('[themesInstall] runInstall ha sollevato un errore non gestito:', e);
                });
            });

            ctx.body = {
                success: true,
                installId,
                status: job.status,
                themeName: job.themeName,
                overwriting: confirmOverwrite,
            };
        },
    });

    routes.push({
        method: 'GET',
        path: '/themes/install/:installId/status',
        access: { requiresAuth: true, allowedRoles: [0, 1] },
        handler: async (ctx) => {
            const job = installJobs.get(ctx.params.installId);
            if (!job) {
                ctx.status = 404;
                ctx.body = { success: false, error: 'Job di installazione non trovato (potrebbe essere stato espulso dalla history).' };
                return;
            }
            ctx.body = { success: true, job: snapshotJob(job) };
        },
    });

    // Endpoint di discovery: il client lo interroga al caricamento della pagina
    // per decidere se mostrare il bottone dry-run. Restituisce semplicemente
    // se la feature è abilitata (debugMode >= 1).
    routes.push({
        method: 'GET',
        path: '/themes/install/dryRunAvailable',
        access: { requiresAuth: true, allowedRoles: [0, 1] },
        handler: async (ctx) => {
            ctx.body = { success: true, available: isDryRunEnabled() };
        },
    });

    // Avvia un dry-run: simula tutte le fasi di un'installazione (clone,
    // validate, finalize) emettendo eventi di progress realistici. Nessuna
    // scrittura su disco, nessuna chiamata a git. Gating: debugMode >= 1.
    routes.push({
        method: 'POST',
        path: '/themes/install/dryRun',
        access: { requiresAuth: true, allowedRoles: [0, 1] },
        handler: async (ctx) => {
            if (!isDryRunEnabled()) {
                ctx.status = 403;
                ctx.body = {
                    success: false,
                    error: 'Dry-run disponibile solo con debugMode >= 1 in ital8Config.json5.',
                };
                return;
            }
            if (isInstallingTheme) {
                ctx.status = 409;
                ctx.body = { success: false, error: 'Un\'altra installazione di tema è già in corso.' };
                return;
            }

            const installConfig = loadInstallConfig();
            isInstallingTheme = true;
            const installId = newInstallId();
            const themeName = `dryRunTheme${Math.floor(Math.random() * 10000)}`;
            const job = {
                installId,
                status: JOB_STATUS.PENDING,
                repoUrl: '(dry-run: nessun repo reale)',
                branchOrTag: null,
                themeName,
                isAdminTheme: null,
                confirmOverwrite: false,
                phases: [],
                currentPhase: null,
                warnings: [],
                error: null,
                result: null,
                progress: null,
                progressHistory: [],
                startedAt: new Date().toISOString(),
                finishedAt: null,
                user: ctx.session && ctx.session.user ? ctx.session.user.username : null,
                dryRun: true,
            };
            installJobs.set(installId, job);

            setImmediate(() => {
                try {
                    runDryRunInstall(job, installConfig);
                } catch (e) {
                    console.error('[themesInstall] runDryRunInstall ha sollevato un errore non gestito:', e);
                    job.status = JOB_STATUS.FAILED;
                    job.error = e.message;
                    isInstallingTheme = false;
                }
            });

            ctx.body = {
                success: true,
                installId,
                status: job.status,
                themeName,
                dryRun: true,
            };
        },
    });

    return routes;
}

module.exports = {
    getRoutes,
    // export interno per i test
    _validateRepoUrl: validateRepoUrl,
    _extractThemeNameFromUrl: extractThemeNameFromUrl,
    _validateBranchOrTag: validateBranchOrTag,
    _validateClonedTheme: validateClonedTheme,
    _kebabToCamel: kebabToCamel,
    _readExistingThemeMetadata: readExistingThemeMetadata,
    _parseGitProgressLine: parseGitProgressLine,
    _isDryRunEnabled: isDryRunEnabled,
    JOB_STATUS,
};
