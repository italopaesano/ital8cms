/**
 * MODULO INSTALLAZIONE PLUGIN DA REPO GIT REMOTO
 *
 * Installa un plugin ital8cms clonando un repository Git pubblico.
 *
 * Vincolo principale: il repository remoto DEVE avere un nome che inizia con
 * il prefisso configurato in `pluginConfig.json5` (default: "ital8cms-plugin-").
 * Quanto segue il prefisso diventa il nome del plugin e DEVE combaciare con il
 * campo "name" in `pluginDescription.json5` del repo clonato.
 *
 * Flusso (fasi):
 *   1. Parse e validazione URL
 *   2. Verifica che la cartella di destinazione non esista
 *   3. Acquisizione lock globale (una sola installazione alla volta)
 *   4. Clone via `git clone`
 *   5. Validazione file richiesti, parsing JSON5
 *   6. Controlli incrociati (name coincide, admin convention, require main.js)
 *   7. Decisione `active` finale, scrittura `pluginConfig.json5` aggiornato
 *   8. Audit log
 *
 * Su QUALUNQUE fallimento dopo lo step 4 (clone riuscito) la cartella appena
 * creata viene rimossa per non lasciare uno stato sporco.
 *
 * I job sono asincroni: il client riceve subito un installId e fa polling
 * sull'endpoint di stato. Lo stato vive in una Map in memoria (FIFO eviction).
 *
 * ROUTE ESPOSTE (verranno prefissate con `/api/admin/`):
 *   POST /plugins/install                       avvia un'installazione
 *   GET  /plugins/install/:installId/status     stato di un job
 *   GET  /plugins/install/restart-info          info per il bottone "Riavvia"
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const loadJson5 = require('../../core/loadJson5');

// ----- COSTANTI / PATH -------------------------------------------------------

const ADMIN_PLUGIN_DIR = __dirname;
const PLUGINS_PATH = path.join(ADMIN_PLUGIN_DIR, '../../plugins');
const AUDIT_LOG_PATH = path.join(ADMIN_PLUGIN_DIR, 'pluginInstallLog.json5');

const JOB_STATUS = Object.freeze({
    PENDING: 'pending',
    RUNNING: 'running',
    SUCCESS: 'success',
    FAILED: 'failed',
});

// ----- STATE STORE -----------------------------------------------------------

const installJobs = new Map();
let isInstalling = false;

function loadInstallConfig() {
    const adminConfig = loadJson5(path.join(ADMIN_PLUGIN_DIR, 'pluginConfig.json5'));
    return (adminConfig.custom && adminConfig.custom.install) || {};
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
    return `inst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function snapshotJob(job) {
    return {
        installId: job.installId,
        status: job.status,
        repoUrl: job.repoUrl,
        branchOrTag: job.branchOrTag || null,
        wantActive: job.wantActive,
        pluginName: job.pluginName || null,
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

function extractPluginNameFromUrl(repoUrl, repoPrefix) {
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
    const pluginName = repoName.slice(repoPrefix.length);
    if (!pluginName) {
        return {
            ok: false,
            error: `Nome plugin vuoto: il repo deve essere "${repoPrefix}<nomePlugin>".`,
        };
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(pluginName)) {
        return {
            ok: false,
            error: `Nome plugin "${pluginName}" non valido: deve iniziare con una lettera e contenere solo lettere, cifre, "_" e "-".`,
        };
    }
    return { ok: true, value: pluginName };
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

function targetPluginDir(pluginName) {
    return path.join(PLUGINS_PATH, pluginName);
}

function pluginDirExists(pluginName) {
    return fs.existsSync(targetPluginDir(pluginName));
}

function rollbackPluginDir(pluginName) {
    const dir = targetPluginDir(pluginName);
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

function validateClonedPlugin(pluginDir, expectedPluginName) {
    const warnings = [];

    const mainPath = path.join(pluginDir, 'main.js');
    const configPath = path.join(pluginDir, 'pluginConfig.json5');
    const descriptionPath = path.join(pluginDir, 'pluginDescription.json5');

    const missingFiles = [];
    if (!fs.existsSync(mainPath)) missingFiles.push('main.js');
    if (!fs.existsSync(configPath)) missingFiles.push('pluginConfig.json5');
    if (!fs.existsSync(descriptionPath)) missingFiles.push('pluginDescription.json5');

    if (missingFiles.length > 0) {
        return {
            ok: false,
            error: `Struttura plugin non valida: file mancanti -> ${missingFiles.join(', ')}.`,
        };
    }

    let config;
    let description;
    try {
        config = loadJson5(configPath);
    } catch (e) {
        return { ok: false, error: `pluginConfig.json5 non parsificabile: ${e.message}` };
    }
    try {
        description = loadJson5(descriptionPath);
    } catch (e) {
        return { ok: false, error: `pluginDescription.json5 non parsificabile: ${e.message}` };
    }

    if (!description.name || typeof description.name !== 'string') {
        return { ok: false, error: 'Campo "name" mancante o non stringa in pluginDescription.json5.' };
    }
    if (description.name !== expectedPluginName) {
        return {
            ok: false,
            error: `Nome plugin incongruente: il repo implica "${expectedPluginName}" ma pluginDescription.json5 dichiara "${description.name}".`,
        };
    }

    if (expectedPluginName.startsWith('admin')) {
        if (!Array.isArray(config.adminSections)) {
            return {
                ok: false,
                error: 'Il plugin admin deve dichiarare "adminSections" (array) in pluginConfig.json5.',
            };
        }
        if (config.adminSections.length === 0) {
            warnings.push('Plugin admin con "adminSections" vuoto: nessuna sezione verrà esposta.');
        }
    }

    try {
        require(mainPath);
    } catch (e) {
        return { ok: false, error: `main.js non caricabile (require fallito): ${e.message}` };
    }

    const nodeDeps = config.nodeModuleDependency || {};
    const nodeDepsList = Object.keys(nodeDeps);
    if (nodeDepsList.length > 0) {
        warnings.push(
            `Il plugin dichiara ${nodeDepsList.length} dipendenza/e npm: ${nodeDepsList.join(', ')}.`,
        );
    }

    return {
        ok: true,
        value: {
            config,
            description,
            configPath,
            nodeModuleDependency: nodeDeps,
            warnings,
        },
    };
}

// ----- WRITE FINAL CONFIG ----------------------------------------------------

function finalizePluginConfig({ configPath, config, wantActive, hasNpmDeps }) {
    const updated = Object.assign({}, config);
    updated.active = (wantActive && !hasNpmDeps) ? 1 : 0;
    if (typeof updated.isInstalled === 'undefined') {
        updated.isInstalled = 1;
    } else {
        updated.isInstalled = 1;
    }
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
        console.error('[pluginsInstall] Impossibile scrivere audit log:', e.message);
    }
}

// ----- SUPERVISOR DETECTION --------------------------------------------------

function detectSupervisor() {
    if (process.env.PM2_HOME || process.env.pm_id) {
        return { type: 'pm2', label: 'PM2' };
    }
    if (process.env.NODEMON || process.env.NODEMON_PID) {
        return { type: 'nodemon', label: 'nodemon' };
    }
    if (process.ppid && process.ppid !== 1) {
        return { type: 'unknown', label: 'sconosciuto' };
    }
    return { type: 'none', label: 'nessun supervisor rilevato' };
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
        wantActive: job.wantActive,
        startedAt: job.startedAt,
        user: job.user || null,
    };

    let createdDir = false;

    try {
        // FASE 1 - URL parsing già fatto in handler; qui usiamo i valori già validati.
        pushPhase(job, 'parseUrl', true, `Plugin name: "${job.pluginName}"`);

        // FASE 2 - check destinazione
        if (pluginDirExists(job.pluginName)) {
            throw new Error(`La cartella plugins/${job.pluginName} esiste già. Rimuoverla o disinstallare il plugin esistente prima di reinstallare.`);
        }
        pushPhase(job, 'checkDestination', true);

        // FASE 3 - clone
        pushPhase(job, 'cloneStart', true, job.branchOrTag ? `branch/tag: ${job.branchOrTag}` : 'default branch');
        const cloneRes = await runGitClone({
            repoUrl: job.repoUrl,
            branchOrTag: job.branchOrTag,
            destDir: targetPluginDir(job.pluginName),
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
        const valRes = validateClonedPlugin(targetPluginDir(job.pluginName), job.pluginName);
        if (!valRes.ok) {
            throw new Error(valRes.error);
        }
        pushPhase(job, 'validate', true);
        valRes.value.warnings.forEach(w => job.warnings.push(w));

        // FASE 5 - scrittura config finale
        const hasNpmDeps = Object.keys(valRes.value.nodeModuleDependency).length > 0;
        const finalConfig = finalizePluginConfig({
            configPath: valRes.value.configPath,
            config: valRes.value.config,
            wantActive: job.wantActive,
            hasNpmDeps,
        });
        pushPhase(job, 'finalizeConfig', true, `active=${finalConfig.active}, isInstalled=${finalConfig.isInstalled}`);

        // SUCCESS
        job.status = JOB_STATUS.SUCCESS;
        job.finishedAt = new Date().toISOString();
        job.result = {
            pluginName: job.pluginName,
            pluginPath: targetPluginDir(job.pluginName),
            active: finalConfig.active === 1,
            isInstalled: finalConfig.isInstalled === 1,
            hasNpmDeps,
            nodeModuleDependency: valRes.value.nodeModuleDependency,
            description: {
                name: valRes.value.description.name,
                version: valRes.value.description.version || null,
                author: valRes.value.description.author || null,
                license: valRes.value.description.license || null,
            },
            warnings: job.warnings.slice(),
            wantedActive: job.wantActive,
            wasDeactivatedDueToNpmDeps: job.wantActive && hasNpmDeps,
        };

        appendAuditLog(Object.assign({}, auditBase, {
            outcome: 'success',
            pluginName: job.pluginName,
            finishedAt: job.finishedAt,
            warnings: job.warnings,
        }));

    } catch (err) {
        if (createdDir) {
            try { rollbackPluginDir(job.pluginName); } catch (e) { /* noop */ }
            pushPhase(job, 'rollback', true, 'Cartella rimossa.');
        }
        job.status = JOB_STATUS.FAILED;
        job.finishedAt = new Date().toISOString();
        job.error = err.message;

        appendAuditLog(Object.assign({}, auditBase, {
            outcome: 'failure',
            pluginName: job.pluginName || null,
            finishedAt: job.finishedAt,
            error: err.message,
        }));
    } finally {
        isInstalling = false;
        pruneJobHistory(installConfig.maxJobHistory || 50);
    }
}

// ----- ROUTES ----------------------------------------------------------------

function getRoutes() {
    const routes = [];

    routes.push({
        method: 'POST',
        path: '/plugins/install',
        access: { requiresAuth: true, allowedRoles: [0, 1] },
        handler: async (ctx) => {
            const installConfig = loadInstallConfig();
            const repoPrefix = installConfig.repoPrefix || 'ital8cms-plugin-';

            if (isInstalling) {
                ctx.status = 409;
                ctx.body = { success: false, error: 'Un\'altra installazione è già in corso. Attendere il completamento.' };
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
            const nameV = extractPluginNameFromUrl(urlV.value, repoPrefix);
            if (!nameV.ok) {
                ctx.status = 400;
                ctx.body = { success: false, error: nameV.error };
                return;
            }
            if (pluginDirExists(nameV.value)) {
                ctx.status = 409;
                ctx.body = { success: false, error: `La cartella plugins/${nameV.value} esiste già.` };
                return;
            }

            const wantActive = body.wantActive === true || body.wantActive === 1 || body.wantActive === '1';

            isInstalling = true;
            const installId = newInstallId();
            const job = {
                installId,
                status: JOB_STATUS.PENDING,
                repoUrl: urlV.value,
                branchOrTag: branchV.value,
                wantActive: !!wantActive,
                pluginName: nameV.value,
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
                    console.error('[pluginsInstall] runInstall ha sollevato un errore non gestito:', e);
                });
            });

            ctx.body = { success: true, installId, status: job.status };
        },
    });

    routes.push({
        method: 'GET',
        path: '/plugins/install/restart-info',
        access: { requiresAuth: true, allowedRoles: [0, 1] },
        handler: async (ctx) => {
            ctx.body = { success: true, supervisor: detectSupervisor() };
        },
    });

    // POST /api/admin/restart - termina il processo Node. Funziona solo se
    // un supervisor esterno (PM2, nodemon, systemd) lo fa ripartire; senza
    // supervisor il server si ferma. La UI mostra un avviso esplicito in
    // base al risultato di detectSupervisor().
    routes.push({
        method: 'POST',
        path: '/restart',
        access: { requiresAuth: true, allowedRoles: [0, 1] },
        handler: async (ctx) => {
            ctx.body = { success: true, message: 'Riavvio in corso...' };
            const supervisor = detectSupervisor();
            const user = ctx.session && ctx.session.user ? ctx.session.user.username : 'unknown';
            console.log(`[pluginsInstall] Restart richiesto da "${user}" (supervisor: ${supervisor.label}). Uscita tra 500ms.`);
            setTimeout(() => {
                process.exit(0);
            }, 500);
        },
    });

    routes.push({
        method: 'GET',
        path: '/plugins/install/:installId/status',
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
    _extractPluginNameFromUrl: extractPluginNameFromUrl,
    _validateBranchOrTag: validateBranchOrTag,
    _validateClonedPlugin: validateClonedPlugin,
    _detectSupervisor: detectSupervisor,
    JOB_STATUS,
};
