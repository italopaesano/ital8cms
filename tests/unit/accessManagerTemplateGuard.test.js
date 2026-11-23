/**
 * Unit test: la guardia per i template × REVIEW.md → A6.
 *
 * Il difetto che questi test presidiano: `checkInTemplate` faceva
 * `ctx.redirect(...)` e poi `return`, ma quel `return` esce dalla FUNZIONE e non
 * dal template. L'EJS proseguiva, `index.js` assegnava `ctx.body`, e la risposta
 * era un **302 con la pagina protetta renderizzata per intero nel corpo**. Un
 * browser segue il redirect e non mostra nulla; `curl` senza `-L` legge tutto.
 *
 * Il test più importante è il penultimo: rende un template EJS **vero** che
 * chiama la guardia, con lo stesso `try/catch` che index.js monta attorno ai suoi
 * tre `renderFile`, e pretende che il corpo non venga assegnato. Gli altri
 * verificano il contratto pezzo per pezzo; quello verifica la conseguenza.
 */

jest.mock('../../core/loadJson5', () => jest.fn());

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const ejs  = require('ejs');

const loadJson5 = require('../../core/loadJson5');
const AccessManager = require('../../plugins/adminAccessControl/lib/accessManager');
const AccessDeniedError = require('../../core/accessDeniedError');

const RULES = Object.freeze({
  hardcodedRules: {
    '/admin': { requiresAuth: true, allowedRoles: [0, 1], priority: 1000, editable: false },
    '/admin/**': { requiresAuth: true, allowedRoles: [0, 1], priority: 100, editable: false },
  },
  customRules: {},
  defaultPolicy: { action: 'allow', redirectOnDenied: '/pluginPages/adminUsers/login.ejs' },
});

function manager() {
  loadJson5.mockImplementation((p) => {
    const file = String(p);
    if (file.endsWith('ital8Config.json5')) return {};
    if (file.endsWith('accessControl.json5')) return RULES;
    throw new Error(`loadJson5 non atteso: ${file}`);
  });
  return new AccessManager({}, '/fake/plugins/adminAccessControl');
}

/** Un ctx Koa finto che registra il redirect, come fa quello vero. */
function fakeCtx({ user = null, reqPath = '/www/riservata.ejs' } = {}) {
  return {
    path: reqPath,
    session: user ? { authenticated: true, user } : {},
    status: 200,
    body: undefined,
    redirect(url) { this.status = 302; this.redirectedTo = url; this.body = `Redirecting to ${url}.`; },
  };
}

const tempFiles = [];
afterEach(() => {
  for (const f of tempFiles) { try { fs.rmSync(f, { force: true }); } catch (_) {} }
  tempFiles.length = 0;
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

// ── Il contratto della guardia ───────────────────────────────────────────────

describe('checkInTemplate — redirige E ferma', () => {
  test('anonimo su requiresAuth → lancia AccessDeniedError', () => {
    const m = manager();
    const ctx = fakeCtx();
    expect(() => m.checkInTemplate(ctx, { requiresAuth: true })).toThrow(AccessDeniedError);
  });

  test('il redirect è impostato PRIMA del lancio, così chi intercetta non deve fabbricare nulla', () => {
    const m = manager();
    const ctx = fakeCtx();
    try { m.checkInTemplate(ctx, { requiresAuth: true }); } catch (_) { /* atteso */ }
    expect(ctx.status).toBe(302);
    expect(ctx.redirectedTo).toBe('/pluginPages/adminUsers/login.ejs');
  });

  test('l\'errore dice PERCHÉ: auth o ruolo', () => {
    const m = manager();
    try {
      m.checkInTemplate(fakeCtx(), { requiresAuth: true });
    } catch (err) {
      expect(err.reason).toBe('auth');
    }
    try {
      m.checkInTemplate(fakeCtx({ user: { roleIds: [2] } }), { allowedRoles: [0, 1] });
    } catch (err) {
      expect(err.reason).toBe('role');
    }
  });

  test('ruolo insufficiente → stesso trattamento dell\'anonimo, verso access-denied', () => {
    const m = manager();
    const ctx = fakeCtx({ user: { roleIds: [2] } });
    expect(() => m.checkInTemplate(ctx, { allowedRoles: [0, 1] })).toThrow(AccessDeniedError);
    expect(ctx.redirectedTo).toMatch(/access-denied/);
  });

  test('accesso consentito → non lancia e non redirige', () => {
    const m = manager();
    const ctx = fakeCtx({ user: { roleIds: [1] } });
    expect(() => m.checkInTemplate(ctx, { requiresAuth: true, allowedRoles: [0, 1] })).not.toThrow();
    expect(ctx.status).toBe(200);
  });
});

describe('evaluateTemplateAccess — decide senza effetti collaterali', () => {
  test('non redirige mai, qualunque sia il verdetto', () => {
    const m = manager();
    const ctx = fakeCtx();
    const verdict = m.evaluateTemplateAccess(ctx, { requiresAuth: true });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('auth');
    expect(verdict.redirectTo).toBe('/pluginPages/adminUsers/login.ejs');
    expect(ctx.status).toBe(200);            // nessun effetto sul ctx
    expect(ctx.redirectedTo).toBeUndefined();
  });

  test('è la fonte unica: lo stesso verdetto che checkInTemplate usa per decidere', () => {
    const m = manager();
    for (const [user, req] of [[null, { requiresAuth: true }],
                               [{ roleIds: [2] }, { allowedRoles: [0, 1] }],
                               [{ roleIds: [1] }, { allowedRoles: [0, 1] }]]) {
      const verdict = m.evaluateTemplateAccess(fakeCtx({ user }), req);
      const lancia = (() => {
        try { m.checkInTemplate(fakeCtx({ user }), req); return false; } catch (_) { return true; }
      })();
      expect(lancia).toBe(!verdict.allowed);
    }
  });
});

// ── La conseguenza: il corpo non viene assegnato ─────────────────────────────

describe('il rendering si ferma davvero (la conseguenza che contava)', () => {
  const CONTENUTO_SEGRETO = 'CONTENUTO-RISERVATO-CHE-NON-DEVE-USCIRE';

  function templateCheGuarda() {
    const file = path.join(os.tmpdir(), `a6-guard-${Date.now()}-${Math.random().toString(36).slice(2)}.ejs`);
    tempFiles.push(file);
    fs.writeFileSync(file,
      '<% passData.plugin.adminAccessControl.check({ requiresAuth: true }, passData) %>\n'
      + `<h1>${CONTENUTO_SEGRETO}</h1>\n`, 'utf8');
    return file;
  }

  /** Riproduce il try/catch che index.js monta attorno ai suoi tre renderFile. */
  async function renderComeIndexJs(file, ctx, guard) {
    const passData = { ctx, plugin: { adminAccessControl: guard } };
    try {
      ctx.body = await ejs.renderFile(file, { passData });
    } catch (accessErr) {
      if (!(accessErr instanceof AccessDeniedError)) throw accessErr;
    }
    return ctx;
  }

  test('anonimo: 302 e il corpo NON contiene la pagina protetta', async () => {
    const m = manager();
    const guard = { check: (req, pd) => m.checkInTemplate(pd.ctx, req) };
    const ctx = await renderComeIndexJs(templateCheGuarda(), fakeCtx(), guard);

    expect(ctx.status).toBe(302);
    expect(String(ctx.body)).not.toContain(CONTENUTO_SEGRETO);
  });

  test('autenticato con il ruolo giusto: la pagina viene resa', async () => {
    const m = manager();
    const guard = { check: (req, pd) => m.checkInTemplate(pd.ctx, req) };
    const ctx = await renderComeIndexJs(templateCheGuarda(), fakeCtx({ user: { roleIds: [1] } }), guard);

    expect(ctx.status).toBe(200);
    expect(String(ctx.body)).toContain(CONTENUTO_SEGRETO);
  });

  test('un errore che NON è di accesso continua a propagarsi', async () => {
    // Il catch non deve diventare un soffocatore di errori veri.
    const guard = { check: () => { throw new TypeError('difetto vero nel template'); } };
    await expect(renderComeIndexJs(templateCheGuarda(), fakeCtx(), guard))
      .rejects.toThrow(TypeError);
  });
});

// ── Il presidio strutturale su index.js ──────────────────────────────────────

describe('index.js — tutti i punti di render sono protetti', () => {
  // Un quarto punto di render aggiunto senza il catch riaprirebbe il difetto in
  // silenzio: questo test conta i render e pretende che ognuno sia coperto.
  test('ogni `ejs.renderFile(filePath` è dentro un catch di AccessDeniedError', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../index.js'), 'utf8');
    const render = (src.match(/ctx\.body = await ejs\.renderFile\(filePath/g) || []).length;
    const catches = (src.match(/accessErr instanceof AccessDeniedError/g) || []).length;

    expect(render).toBeGreaterThan(0);
    expect(catches).toBe(render);
  });

  test('la sentinella è importata, non confrontata per nome', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../index.js'), 'utf8');
    expect(src).toMatch(/require\(["']\.\/core\/accessDeniedError["']\)/);
  });
});
