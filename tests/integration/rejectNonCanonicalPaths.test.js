/**
 * tests/integration/rejectNonCanonicalPaths.test.js
 *
 * Test di integrazione per la difesa contro il path/URL normalization mismatch
 * (audit sicurezza #1 — bypass del controllo accessi admin via path non canonico).
 *
 * Verifica end-to-end i due layer:
 *   • Layer A (OBBLIGATORIO): la guardia di adminAccessControl canonicalizza il
 *     path prima del match → i path non canonici verso /admin sono bloccati anche
 *     quando il gate globale B è disattivato.
 *   • Layer B (OPZIONALE, gate rejectNonCanonicalPaths): rifiuta con 400 i path
 *     non canonici a monte di tutto.
 *
 * Eseguire con:
 *   npx jest tests/integration/rejectNonCanonicalPaths.test.js --verbose
 *
 * ┌────────────────────────────────────────────────────────────────┐
 * │  Fase 1 — B ABILITATO (default)                                 │
 * │    • path non canonici → 400 (gate B)                          │
 * │    • /admin canonico (anon) → 302 login                        │
 * │    • pagina pubblica → non 400                                  │
 * ├────────────────────────────────────────────────────────────────┤
 * │  Fase 2 — B DISABILITATO (prova che A chiude da sola)          │
 * │    • path non canonici verso /admin (anon) → 302 login, NON 200│
 * │    • /admin canonico (anon) → 302 login                        │
 * └────────────────────────────────────────────────────────────────┘
 *
 * Porte riservate (evitano conflitti con prod e altri test):
 *   Fase 1 (B on):  HTTP 19310
 *   Fase 2 (B off): HTTP 19311
 */

'use strict';

jest.setTimeout(60000);

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const json5 = require('json5');

const PROJECT_ROOT = path.join(__dirname, '../..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'ital8Config.json5');

const PORT_B_ON = 19310;
const PORT_B_OFF = 19311;

// ── Utilities ──────────────────────────────────────────────────────────────────

/** GET senza seguire i redirect (così un 302 resta osservabile come 302). */
function httpGet(urlPath, port, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout ${urlPath}`)));
    req.on('error', reject);
    req.end();
  });
}

/**
 * Avvia il server con override di httpPort e rejectNonCanonicalPaths.
 * Modifica temporaneamente ital8Config.json5 e lo ripristina alla fine.
 */
function spawnServer(httpPort, rejectNonCanonicalPaths) {
  const originalRaw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const original = json5.parse(originalRaw);

  const testConf = {
    ...original,
    httpPort,
    debugMode: 0,
    rejectNonCanonicalPaths,
    https: { ...original.https, enabled: false },
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(testConf, null, 2), 'utf8');

  const proc = spawn('node', ['index.js'], { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });

  const restoreConfig = () => { fs.writeFileSync(CONFIG_PATH, originalRaw, 'utf8'); };

  const waitForReady = (timeoutMs = 30000) => new Promise((resolve, reject) => {
    let buf = '';
    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout.removeListener('data', onData);
      proc.stderr.removeListener('data', onData);
    };
    const onData = (chunk) => {
      buf += chunk.toString();
      if (buf.includes(`${httpPort}`)) {
        cleanup();
        setTimeout(() => resolve(buf), 500);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout in attesa di server ready\nOutput:\n${buf}`));
    }, timeoutMs);
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.once('exit', (code) => {
      cleanup();
      reject(new Error(`Server uscito (codice ${code}) prima di essere pronto\nOutput:\n${buf}`));
    });
  });

  return { proc, restoreConfig, waitForReady };
}

async function killProcess(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) return resolve();
    const forceKill = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} }, 3000);
    proc.once('exit', () => { clearTimeout(forceKill); resolve(); });
    proc.kill('SIGTERM');
  });
}

// Vettori di bypass (risolvono tutti a /admin/usersManagment/index.ejs)
const CANONICAL_ADMIN = '/admin/usersManagment/index.ejs';
const NON_CANONICAL_ADMIN = [
  '/./admin/usersManagment/index.ejs',
  '/x/../admin/usersManagment/index.ejs',
  '//admin/usersManagment/index.ejs',
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FASE 1 — B ABILITATO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('rejectNonCanonicalPaths — Fase 1: B ABILITATO (gate globale)', () => {
  let server;

  beforeAll(async () => {
    server = spawnServer(PORT_B_ON, true);
    await server.waitForReady();
  });

  afterAll(async () => {
    if (server) { await killProcess(server.proc); server.restoreConfig(); }
  });

  test.each(NON_CANONICAL_ADMIN)('path non canonico %j → 400', async (p) => {
    const res = await httpGet(p, PORT_B_ON);
    expect(res.status).toBe(400);
  });

  test('slash percent-encoded /admin%2f... → 400', async () => {
    const res = await httpGet('/admin%2fusersManagment/index.ejs', PORT_B_ON);
    expect(res.status).toBe(400);
  });

  test('/admin canonico (anon) → 302 verso il login (non 400)', async () => {
    const res = await httpGet(CANONICAL_ADMIN, PORT_B_ON);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/pluginPages/adminUsers/login.ejs');
  });

  test('pagina pubblica di login → NON 400 (il gate non è troppo severo)', async () => {
    const res = await httpGet('/pluginPages/adminUsers/login.ejs', PORT_B_ON);
    expect(res.status).not.toBe(400);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FASE 2 — B DISABILITATO (prova che il Layer A chiude il bypass da solo)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('rejectNonCanonicalPaths — Fase 2: B DISABILITATO (A da sola)', () => {
  let server;

  beforeAll(async () => {
    server = spawnServer(PORT_B_OFF, false);
    await server.waitForReady();
  });

  afterAll(async () => {
    if (server) { await killProcess(server.proc); server.restoreConfig(); }
  });

  test.each(NON_CANONICAL_ADMIN)(
    'INVARIANTE: path non canonico %j (anon) → 302 login, MAI 200',
    async (p) => {
      const res = await httpGet(p, PORT_B_OFF);
      expect(res.status).not.toBe(200);          // il bypass NON deve servire la pagina
      expect(res.status).toBe(302);              // A canonicalizza → regola /admin/** applicata
      expect(res.headers.location).toContain('/pluginPages/adminUsers/login.ejs');
    }
  );

  test('/admin canonico (anon) → 302 login', async () => {
    const res = await httpGet(CANONICAL_ADMIN, PORT_B_OFF);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/pluginPages/adminUsers/login.ejs');
  });
});
