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

// Parser delle righe di progress emesse da `git clone --progress` su stderr.
// Riconosce tre stadi: 'receiving' (download oggetti), 'resolving' (risoluzione
// delta) e 'updatingFiles' (checkout dei file sul working tree).
// Ritorna null se la riga non è un progress riconosciuto.
//
// Stessa implementazione di themesInstall.js — i due moduli sono volutamente
// paralleli e duplicare il parser (poche righe) evita di accoppiarli.
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
        let timedOut = false;
        let partialLine = '';

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
            // git emette progress separati da \r (ridisegno della stessa riga)
            // oppure \n alla fine. Splittiamo su entrambi e ricostruiamo le righe.
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
            // Flush eventuale ultimo frammento di riga.
            if (partialLine && typeof onProgress === 'function') {
                const ev = parseGitProgressLine(partialLine);
                if (ev) {
                    try { onProgress(ev); } catch (e) { /* noop */ }
                }
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

        // Throttle progress: max 1 update ogni 100ms. Cambio stage e percent===100
        // bypassano il throttle per non perdere transizioni e completamenti.
        // 100ms è coerente con un polling client a 400ms (~4 eventi catturati
        // per ogni round-trip di polling).
        const THROTTLE_MS = 100;
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
                job.progressHistory.splice(0, job.progressHistory.length - HISTORY_CAP);
            }
        };

        const cloneRes = await runGitClone({
            repoUrl: job.repoUrl,
            branchOrTag: job.branchOrTag,
            destDir: targetPluginDir(job.pluginName),
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
            let rollbackOk = true;
            let rollbackErr = null;
            try {
                rollbackPluginDir(job.pluginName);
            } catch (e) {
                rollbackOk = false;
                rollbackErr = e.message;
            }
            if (rollbackOk) {
                pushPhase(job, 'rollback', true, 'Cartella rimossa.');
            } else {
                // Rollback fallito: i file restano su disco. È fondamentale che
                // l'utente sia avvisato perché altrimenti vedrebbe "failed" ma
                // troverebbe il plugin sul filesystem (potenzialmente funzionante
                // al prossimo boot), generando confusione su quale sia lo stato
                // reale.
                pushPhase(job, 'rollback', false,
                    `Rollback fallito: ${rollbackErr}. I file restano in plugins/${job.pluginName} — rimuoverli manualmente.`);
                job.warnings.push(
                    `Rollback fallito: la cartella plugins/${job.pluginName} non è stata rimossa (${rollbackErr}). ` +
                    `Verifica manualmente lo stato del filesystem prima di ritentare l'installazione.`
                );
            }
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

// ----- DRY-RUN ---------------------------------------------------------------

// Simula un'installazione plugin completa emettendo finti eventi di progress
// nello stesso formato del git clone reale. Utile per:
//   - testare visivamente la progress bar senza dover pushare un plugin reale
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

    // Numeri plausibili per un plugin di taglia media.
    const totalObjects = 180;
    const totalDeltas  = 60;
    const totalFiles   = 120;
    const totalBytes   = 3 * 1024 * 1024;

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
            pushPhase(job, 'validate', true, 'DRY-RUN: struttura plugin simulata');
            await sleep(tailMs / 3);
            pushPhase(job, 'finalizeConfig', true,
                `DRY-RUN: active=${job.wantActive ? 1 : 0}, isInstalled=1`);
            await sleep(tailMs / 3);

            job.status = JOB_STATUS.SUCCESS;
            job.finishedAt = new Date().toISOString();
            job.result = {
                pluginName: job.pluginName,
                pluginPath: '(dry-run: nessun path reale)',
                active: !!job.wantActive,
                isInstalled: true,
                hasNpmDeps: false,
                nodeModuleDependency: {},
                description: {
                    name: job.pluginName,
                    version: '1.0.0-dryrun',
                    author: 'dry-run simulator',
                    license: 'N/A',
                },
                warnings: ['DRY-RUN: nessuna modifica reale al filesystem.'],
                wantedActive: !!job.wantActive,
                wasDeactivatedDueToNpmDeps: false,
                dryRun: true,
            };
            job.warnings.push('Questo è un dry-run: nessun plugin reale è stato installato.');
        } catch (err) {
            job.status = JOB_STATUS.FAILED;
            job.finishedAt = new Date().toISOString();
            job.error = `Errore durante dry-run: ${err.message}`;
        } finally {
            isInstalling = false;
            pruneJobHistory(installConfig.maxJobHistory || 50);
        }
    })();
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
                progress: null,
                progressHistory: [],
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

    // Endpoint di discovery: il client lo interroga al caricamento della pagina
    // per decidere se mostrare il bottone dry-run. Restituisce semplicemente
    // se la feature è abilitata (debugMode >= 1).
    routes.push({
        method: 'GET',
        path: '/plugins/install/dryRunAvailable',
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
        path: '/plugins/install/dryRun',
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
            if (isInstalling) {
                ctx.status = 409;
                ctx.body = { success: false, error: 'Un\'altra installazione di plugin è già in corso.' };
                return;
            }

            const installConfig = loadInstallConfig();
            const body = ctx.request.body || {};
            const wantActive = body.wantActive === true || body.wantActive === 1 || body.wantActive === '1';

            isInstalling = true;
            const installId = newInstallId();
            const pluginName = `dryRunPlugin${Math.floor(Math.random() * 10000)}`;
            const job = {
                installId,
                status: JOB_STATUS.PENDING,
                repoUrl: '(dry-run: nessun repo reale)',
                branchOrTag: null,
                wantActive: !!wantActive,
                pluginName,
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
                    console.error('[pluginsInstall] runDryRunInstall ha sollevato un errore non gestito:', e);
                    job.status = JOB_STATUS.FAILED;
                    job.error = e.message;
                    isInstalling = false;
                }
            });

            ctx.body = {
                success: true,
                installId,
                status: job.status,
                pluginName,
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
    _extractPluginNameFromUrl: extractPluginNameFromUrl,
    _validateBranchOrTag: validateBranchOrTag,
    _validateClonedPlugin: validateClonedPlugin,
    _detectSupervisor: detectSupervisor,
    _parseGitProgressLine: parseGitProgressLine,
    _isDryRunEnabled: isDryRunEnabled,
    JOB_STATUS,
};
