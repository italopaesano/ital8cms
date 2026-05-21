/**
 * MODULO INSTALLAZIONE TEMA DA REPO GIT REMOTO
 *
 * Installa un tema ital8cms clonando un repository Git pubblico.
 *
 * Vincolo principale: il repository remoto DEVE avere un nome che inizia con
 * il prefisso configurato in `pluginConfig.json5` (default: "ital8cms-theme-").
 *
 * Convenzione admin theme: se il nome del repo dopo il prefisso inizia con
 * "admin-" (es. "ital8cms-theme-admin-foo"), il tema è considerato un tema
 * admin e DEVE dichiarare `isAdminTheme: true` in `themeConfig.json5`.
 * Viceversa, un repo SENZA "admin-" DEVE dichiarare `isAdminTheme: false`.
 * Mismatch tra naming e flag = installazione fallita con rollback.
 *
 * Nome cartella tema: la parte del nome repo dopo il prefisso viene convertita
 * da kebab-case a camelCase.
 *   "ital8cms-theme-foo"            -> dir themes/foo/
 *   "ital8cms-theme-my-cool-theme"  -> dir themes/myCoolTheme/
 *   "ital8cms-theme-admin-foo"      -> dir themes/adminFoo/         (admin)
 *   "ital8cms-theme-admin-my-foo"   -> dir themes/adminMyFoo/       (admin)
 *
 * Post-installazione il tema viene SEMPRE lasciato disattivato e marcato come
 * non installato (`active: 0`, `isInstalled: 0`). L'attivazione manuale è
 * responsabilità dell'amministratore tramite la pagina di gestione temi.
 *
 * Flusso (fasi):
 *   1. Parse e validazione URL, estrazione nome tema, detection admin convention
 *   2. Verifica che la cartella di destinazione non esista
 *   3. Acquisizione lock globale (una sola installazione tema alla volta)
 *   4. Clone via `git clone`
 *   5. Validazione file richiesti, parsing JSON5
 *   6. Controlli incrociati (name coincide, isAdminTheme coerente con URL)
 *   7. Forzatura `active: 0`, `isInstalled: 0`, scrittura `themeConfig.json5`
 *   8. Audit log
 *
 * Su QUALUNQUE fallimento dopo lo step 4 (clone riuscito) la cartella appena
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
        phases: job.phases.slice(),
        currentPhase: job.currentPhase || null,
        error: job.error || null,
        warnings: job.warnings.slice(),
        result: job.result || null,
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

function extractThemeNameFromUrl(repoUrl, repoPrefix, adminInfix) {
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
            error: `Nome tema vuoto: il repo deve essere "${repoPrefix}<nomeTema>" oppure "${repoPrefix}${adminInfix}<nomeTema>".`,
        };
    }

    // Validazione caratteri raw segment: solo lettere, cifre, '-' e '_'.
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(rawSegment)) {
        return {
            ok: false,
            error: `Nome repo "${rawSegment}" non valido: deve iniziare con una lettera e contenere solo lettere, cifre, "_" e "-".`,
        };
    }

    // Detection admin convention: il segmento inizia con "admin-" (con trattino).
    // Il caso "admin" da solo è rifiutato perché lascia il nome tema vuoto.
    let isAdminTheme = false;
    let baseSegment = rawSegment;
    if (rawSegment === adminInfix.replace(/-$/, '')) {
        return {
            ok: false,
            error: `Nome tema vuoto dopo il marker admin: il repo deve essere "${repoPrefix}${adminInfix}<nomeTema>".`,
        };
    }
    if (rawSegment.startsWith(adminInfix)) {
        isAdminTheme = true;
        // Conserviamo il prefisso "admin-" nella conversione camelCase: diventerà "admin..."
        baseSegment = rawSegment;
    }

    const themeName = kebabToCamel(baseSegment);
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
            isAdminTheme,
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

function writeJson5Atomic(filePath, dataObj, headerComment) {
    const header = headerComment || '// This file follows the JSON5 standard - comments and trailing commas are supported';
    const content = `${header}\n${JSON.stringify(dataObj, null, 2)}\n`;
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, filePath);
}

// ----- GIT CLONE -------------------------------------------------------------

function runGitClone({ repoUrl, branchOrTag, destDir, timeoutMs }) {
    return new Promise((resolve) => {
        const args = ['clone', '--depth', '1'];
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
        let timedOut = false;

        const child = spawn('git', args, { env });

        const killer = setTimeout(() => {
            timedOut = true;
            try { child.kill('SIGKILL'); } catch (e) { /* noop */ }
        }, timeoutMs);

        child.stdout.on('data', (d) => { stdoutBuf += d.toString(); });
        child.stderr.on('data', (d) => { stderrBuf += d.toString(); });

        child.on('error', (err) => {
            clearTimeout(killer);
            resolve({ ok: false, error: `Impossibile eseguire git: ${err.message}`, stderr: stderrBuf });
        });

        child.on('close', (code) => {
            clearTimeout(killer);
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

function validateClonedTheme(themeDir, expectedThemeName, expectedIsAdminTheme) {
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

    // Cross-check naming convention <-> flag isAdminTheme.
    if (typeof config.isAdminTheme !== 'boolean') {
        return {
            ok: false,
            error: 'themeConfig.json5: il campo "isAdminTheme" è obbligatorio e deve essere booleano (true/false).',
        };
    }
    if (config.isAdminTheme !== expectedIsAdminTheme) {
        if (expectedIsAdminTheme) {
            return {
                ok: false,
                error: 'Mismatch convenzione admin: il nome repo contiene "admin-" ma themeConfig.json5 ha isAdminTheme=false. Correggere il flag o rinominare il repo.',
            };
        }
        return {
            ok: false,
            error: 'Mismatch convenzione admin: il nome repo NON contiene "admin-" ma themeConfig.json5 ha isAdminTheme=true. Correggere il flag o rinominare il repo.',
        };
    }

    return {
        ok: true,
        value: {
            config,
            description,
            configPath,
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
        pushPhase(job, 'parseUrl', true, `Theme name: "${job.themeName}" (admin: ${job.isAdminTheme})`);

        // FASE 2 - check destinazione
        if (themeDirExists(job.themeName)) {
            throw new Error(`La cartella themes/${job.themeName} esiste già. Rimuoverla o disinstallare il tema esistente prima di reinstallare.`);
        }
        pushPhase(job, 'checkDestination', true);

        // FASE 3 - clone
        pushPhase(job, 'cloneStart', true, job.branchOrTag ? `branch/tag: ${job.branchOrTag}` : 'default branch');
        const cloneRes = await runGitClone({
            repoUrl: job.repoUrl,
            branchOrTag: job.branchOrTag,
            destDir: targetThemeDir(job.themeName),
            timeoutMs: installConfig.cloneTimeoutMs || 120000,
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
        const valRes = validateClonedTheme(targetThemeDir(job.themeName), job.themeName, job.isAdminTheme);
        if (!valRes.ok) {
            throw new Error(valRes.error);
        }
        pushPhase(job, 'validate', true);
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
            finishedAt: job.finishedAt,
            warnings: job.warnings,
        }));

    } catch (err) {
        if (createdDir) {
            try { rollbackThemeDir(job.themeName); } catch (e) { /* noop */ }
            pushPhase(job, 'rollback', true, 'Cartella rimossa.');
        }
        job.status = JOB_STATUS.FAILED;
        job.finishedAt = new Date().toISOString();
        job.error = err.message;

        appendAuditLog(Object.assign({}, auditBase, {
            outcome: 'failure',
            themeName: job.themeName || null,
            isAdminTheme: typeof job.isAdminTheme === 'boolean' ? job.isAdminTheme : null,
            finishedAt: job.finishedAt,
            error: err.message,
        }));
    } finally {
        isInstallingTheme = false;
        pruneJobHistory(installConfig.maxJobHistory || 50);
    }
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
            const adminInfix = installConfig.adminInfix || 'admin-';

            if (isInstallingTheme) {
                ctx.status = 409;
                ctx.body = { success: false, error: 'Un\'altra installazione di tema è già in corso. Attendere il completamento.' };
                return;
            }

            const body = ctx.request.body || {};

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
            const nameV = extractThemeNameFromUrl(urlV.value, repoPrefix, adminInfix);
            if (!nameV.ok) {
                ctx.status = 400;
                ctx.body = { success: false, error: nameV.error };
                return;
            }
            if (themeDirExists(nameV.value.themeName)) {
                ctx.status = 409;
                ctx.body = { success: false, error: `La cartella themes/${nameV.value.themeName} esiste già.` };
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
                isAdminTheme: nameV.value.isAdminTheme,
                phases: [],
                currentPhase: null,
                warnings: [],
                error: null,
                result: null,
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

            ctx.body = { success: true, installId, status: job.status, themeName: job.themeName, isAdminTheme: job.isAdminTheme };
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
    JOB_STATUS,
};
