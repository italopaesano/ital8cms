/**
 * Integration tests del modulo themesInstall contro due repository GitHub
 * pubblici creati appositamente per esercitare il flusso end-to-end:
 *
 *   - https://github.com/italopaesano/ital8cms-theme-themePublicForTest.git
 *     (tema pubblico, isAdminTheme: false)
 *
 *   - https://github.com/italopaesano/ital8cms-theme-themeAdminForTest.git
 *     (tema admin,    isAdminTheme: true)
 *
 * Entrambi sono volutamente "ciccioni" (~6MB) per permettere alla progress
 * bar di rendersi visibile durante il clone. Vengono generati dallo script
 * scripts/generateTestThemes.sh.
 *
 * Network dependency: i test richiedono accesso a GitHub. Se irraggiungibile
 * (CI offline, firewall) vengono skippati silenziosamente con un warning a
 * console; il file non fa fallire la suite. La rilevazione avviene a
 * load-time via `git ls-remote` (~1s di overhead, una sola volta).
 *
 * Side effects: ogni test installa il tema nella cartella themes/ del
 * progetto. beforeEach e afterAll fanno cleanup esplicito per non lasciare
 * residui. Il file di audit log plugins/admin/themeInstallLog.json5 viene
 * scritto a ogni install (è gitignored).
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const themesInstall = require(path.join(PROJECT_ROOT, 'plugins', 'admin', 'themesInstall'));
const loadJson5 = require(path.join(PROJECT_ROOT, 'core', 'loadJson5'));

const PUBLIC_REPO = 'https://github.com/italopaesano/ital8cms-theme-themePublicForTest.git';
const ADMIN_REPO  = 'https://github.com/italopaesano/ital8cms-theme-themeAdminForTest.git';
const PUBLIC_THEME_NAME = 'themePublicForTest';
const ADMIN_THEME_NAME  = 'themeAdminForTest';

const THEMES_DIR = path.join(PROJECT_ROOT, 'themes');
const TEST_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Network detection (sync, eseguito a load-time del file)
// ---------------------------------------------------------------------------

function isGitHubReachable() {
  try {
    const result = spawnSync('git', ['ls-remote', '--exit-code', PUBLIC_REPO, 'HEAD'], {
      timeout: 8000,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return result.status === 0;
  } catch (_e) {
    return false;
  }
}

const NETWORK_OK = isGitHubReachable();
if (!NETWORK_OK) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n[themesInstall.realRepo] GitHub irraggiungibile — i test integration ' +
    'contro i repo reali vengono skippati.\n' +
    '                         Per eseguirli, assicurati che github.com sia ' +
    'raggiungibile dal runner.\n'
  );
}
// In offline-mode skippiamo i test ma manteniamo la suite valida.
const testOnline = NETWORK_OK ? test : test.skip;

// ---------------------------------------------------------------------------
// Helpers per invocare le route reali con un ctx Koa mock
// ---------------------------------------------------------------------------

function makeCtx(opts = {}) {
  return {
    request: { body: opts.body || {} },
    params: opts.params || {},
    session: { user: { username: 'jest-realRepo' } },
    status: 200,
    body: null,
  };
}

function findRoute(method, pathPattern) {
  const route = themesInstall.getRoutes().find(
    r => r.method === method && r.path === pathPattern
  );
  if (!route) throw new Error(`Route ${method} ${pathPattern} non trovata`);
  return route;
}

// Esegue POST /themes/install. Se incontra il 409 "altra installazione in
// corso" (lock globale ancora tenuto dal test precedente per qualche motivo)
// attende e ritenta. Il 409 "conflict tema esistente" (body.conflict === true)
// NON viene ritentato perché è uno stato semantico, non un lock temporaneo.
async function postInstall(body) {
  const route = findRoute('POST', '/themes/install');
  for (let attempt = 0; attempt < 60; attempt++) {
    const ctx = makeCtx({ body });
    await route.handler(ctx);
    const isInstallLock = ctx.status === 409 && !ctx.body.conflict;
    if (isInstallLock) {
      await new Promise(r => setTimeout(r, 250));
      continue;
    }
    return { status: ctx.status, body: ctx.body };
  }
  throw new Error('postInstall: lock di installazione mai rilasciato dopo 60 tentativi');
}

async function getJobStatus(installId) {
  const route = findRoute('GET', '/themes/install/:installId/status');
  const ctx = makeCtx({ params: { installId } });
  await route.handler(ctx);
  return ctx.body && ctx.body.job;
}

// Polla lo status finché non raggiunge uno stato terminale (success/failed)
// o scade il timeout. Cadenza coerente con quella del client reale (400ms).
async function waitForJobTerminal(installId, maxMs = TEST_TIMEOUT_MS) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < maxMs) {
    await new Promise(r => setTimeout(r, 250));
    last = await getJobStatus(installId);
    if (!last) continue;
    if (last.status === 'success' || last.status === 'failed') return last;
  }
  throw new Error(
    `Timeout: job ${installId} non terminale dopo ${maxMs}ms ` +
    `(ultimo status: ${last && last.status})`
  );
}

function cleanupTheme(themeName) {
  const dir = path.join(THEMES_DIR, themeName);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('themesInstall — integration vs real GitHub repos', () => {
  beforeEach(() => {
    cleanupTheme(PUBLIC_THEME_NAME);
    cleanupTheme(ADMIN_THEME_NAME);
  });

  afterAll(() => {
    cleanupTheme(PUBLIC_THEME_NAME);
    cleanupTheme(ADMIN_THEME_NAME);
  });

  // -------------------------------------------------------------------------
  // Public theme
  // -------------------------------------------------------------------------

  describe('public theme (isAdminTheme: false)', () => {
    testOnline('install completo: clone → validate → finalize, files su disco', async () => {
      const start = await postInstall({ repoUrl: PUBLIC_REPO });
      expect(start.status).toBe(200);
      expect(start.body.success).toBe(true);
      expect(start.body.themeName).toBe(PUBLIC_THEME_NAME);
      expect(start.body.installId).toMatch(/^tinst_/);

      const job = await waitForJobTerminal(start.body.installId);
      expect(job.status).toBe('success');
      expect(job.error).toBeFalsy();

      // Tutte le fasi attese sono presenti e tutte ok
      const phaseNames = job.phases.map(p => p.name);
      expect(phaseNames).toEqual(
        expect.arrayContaining([
          'parseUrl', 'checkDestination',
          'cloneStart', 'cloneDone',
          'validate', 'finalizeConfig',
        ]),
      );
      for (const ph of job.phases) {
        expect(ph.ok).toBe(true);
      }

      // result: il tema viene sempre installato disattivato
      expect(job.result.themeName).toBe(PUBLIC_THEME_NAME);
      expect(job.result.isAdminTheme).toBe(false);
      expect(job.result.isInstalled).toBe(false);
      expect(job.result.description.name).toBe(PUBLIC_THEME_NAME);
      expect(job.result.description.version).toBeTruthy();

      // Filesystem: struttura tema completa e leggibile
      const dir = path.join(THEMES_DIR, PUBLIC_THEME_NAME);
      expect(fs.existsSync(dir)).toBe(true);
      expect(fs.existsSync(path.join(dir, 'themeConfig.json5'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'themeDescription.json5'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'views'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'views', 'head.ejs'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'views', 'footer.ejs'))).toBe(true);

      // Config finale: isInstalled forzato a 0 dal finalize; legacy 'active' rimosso
      const cfg = loadJson5(path.join(dir, 'themeConfig.json5'));
      expect(cfg.active).toBeUndefined();
      expect(cfg.isInstalled).toBe(0);
      expect(cfg.isAdminTheme).toBe(false);
    }, TEST_TIMEOUT_MS);

    testOnline('cattura progress ben formati durante il clone (best-effort)', async () => {
      const start = await postInstall({ repoUrl: PUBLIC_REPO });
      const job = await waitForJobTerminal(start.body.installId);
      expect(job.status).toBe('success');

      // La cattura del progress dipende dall'output runtime di `git`, che NON è
      // deterministico: su un clone molto veloce (rete/disco rapidi, cache calda)
      // o con git che scarica via bundle-uri/packfile-uri, git può non emettere
      // alcuna riga "Receiving/Resolving/Updating" parsabile → progressHistory
      // vuoto pur essendo il clone perfettamente riuscito.
      //
      // Il parser delle righe di progress è coperto in modo DETERMINISTICO da
      // tests/unit/admin/themesInstall.test.js; qui la verifica è best-effort:
      // se il progress è stato catturato DEVE essere ben formato, altrimenti il
      // test non fallisce (lo segnala soltanto) perché il clone è comunque ok.
      if (job.progressHistory.length === 0) {
        // eslint-disable-next-line no-console
        console.warn(
          '[themesInstall.realRepo] nessun evento di progress catturato ' +
          '(clone troppo veloce o git senza progress incrementale) — ' +
          'asserzioni sul progress saltate, clone comunque riuscito.'
        );
        return;
      }

      // Quando il progress è stato catturato, l'ultimo evento deve essere a 100%
      // di uno stage noto (i tre stage terminano sempre a 100%; isComplete
      // bypassa il throttle, quindi il completamento non viene mai perso).
      const last = job.progressHistory[job.progressHistory.length - 1];
      expect(['receiving', 'resolving', 'updatingFiles']).toContain(last.stage);
      expect(last.percent).toBe(100);
      expect(last.current).toBe(last.total);

      // Ogni evento deve avere un timestamp ISO
      for (const ev of job.progressHistory) {
        expect(typeof ev.at).toBe('string');
        expect(ev.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    }, TEST_TIMEOUT_MS);
  });

  // -------------------------------------------------------------------------
  // Admin theme
  // -------------------------------------------------------------------------

  describe('admin theme (isAdminTheme: true)', () => {
    testOnline('rileva isAdminTheme=true dal themeConfig.json5 clonato', async () => {
      const start = await postInstall({ repoUrl: ADMIN_REPO });
      expect(start.body.success).toBe(true);
      expect(start.body.themeName).toBe(ADMIN_THEME_NAME);

      const job = await waitForJobTerminal(start.body.installId);
      expect(job.status).toBe('success');
      expect(job.result.isAdminTheme).toBe(true);
      expect(job.result.themeName).toBe(ADMIN_THEME_NAME);

      // Il flag deve riflettersi sul config sul disco dopo il finalize
      const dir = path.join(THEMES_DIR, ADMIN_THEME_NAME);
      const cfg = loadJson5(path.join(dir, 'themeConfig.json5'));
      expect(cfg.isAdminTheme).toBe(true);
      expect(cfg.active).toBeUndefined();
      expect(cfg.isInstalled).toBe(0);

      // Anche il themeDescription deve coincidere col nome
      const desc = loadJson5(path.join(dir, 'themeDescription.json5'));
      expect(desc.name).toBe(ADMIN_THEME_NAME);
    }, TEST_TIMEOUT_MS);
  });

  // -------------------------------------------------------------------------
  // Overwrite flow
  // -------------------------------------------------------------------------

  describe('flusso di sovrascrittura', () => {
    testOnline('senza confirmOverwrite la seconda install ritorna 409 conflict', async () => {
      // Prima install: ok
      const first = await postInstall({ repoUrl: PUBLIC_REPO });
      await waitForJobTerminal(first.body.installId);
      expect(fs.existsSync(path.join(THEMES_DIR, PUBLIC_THEME_NAME))).toBe(true);

      // Seconda install senza confirmOverwrite: deve restituire 409 con
      // body.conflict=true e i metadati del tema esistente.
      const second = await postInstall({ repoUrl: PUBLIC_REPO });
      expect(second.status).toBe(409);
      expect(second.body.success).toBe(false);
      expect(second.body.conflict).toBe(true);
      expect(second.body.themeName).toBe(PUBLIC_THEME_NAME);
      expect(second.body.existingTheme).toBeTruthy();
      expect(second.body.existingTheme.name).toBe(PUBLIC_THEME_NAME);
      expect(second.body.existingTheme.isAdminTheme).toBe(false);
    }, TEST_TIMEOUT_MS);

    testOnline('con confirmOverwrite=true la seconda install procede', async () => {
      const first = await postInstall({ repoUrl: PUBLIC_REPO });
      await waitForJobTerminal(first.body.installId);

      const second = await postInstall({
        repoUrl: PUBLIC_REPO,
        confirmOverwrite: true,
      });
      expect(second.status).toBe(200);
      expect(second.body.success).toBe(true);
      expect(second.body.overwriting).toBe(true);

      const job = await waitForJobTerminal(second.body.installId);
      expect(job.status).toBe('success');
      expect(job.result.overwritten).toBe(true);

      // La fase di rimozione del tema preesistente deve essere registrata
      const phaseNames = job.phases.map(p => p.name);
      expect(phaseNames).toContain('overwriteExisting');

      // Il tema su disco è quello "nuovo" (in realtà identico)
      expect(fs.existsSync(path.join(THEMES_DIR, PUBLIC_THEME_NAME))).toBe(true);
    }, TEST_TIMEOUT_MS);
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('gestione errori', () => {
    testOnline('repo inesistente: il job fallisce e non lascia residui su disco', async () => {
      // GitHub risponde rapidamente con "Repository not found" per un repo
      // inesistente. Usiamo un nome chiaramente improbabile.
      const fakeRepo = 'https://github.com/italopaesano/ital8cms-theme-doesNotExistJestTest9999.git';
      const start = await postInstall({ repoUrl: fakeRepo });
      expect(start.status).toBe(200);
      expect(start.body.success).toBe(true);
      const expectedName = 'doesNotExistJestTest9999';

      const job = await waitForJobTerminal(start.body.installId, 30_000);
      expect(job.status).toBe('failed');
      expect(job.error).toBeTruthy();

      // Il rollback deve aver pulito la cartella (se mai era stata creata).
      const dir = path.join(THEMES_DIR, expectedName);
      expect(fs.existsSync(dir)).toBe(false);
    }, TEST_TIMEOUT_MS);
  });
});
