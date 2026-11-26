/**
 * Presidio di CUCITURA: l'hardening deve essere attivo al PRIMO riavvio dopo
 * l'aggiornamento × review della v3.51.0.
 *
 * ─── IL DIFETTO ──────────────────────────────────────────────────────────────
 * `priorityMiddleware()` gira a livello di modulo (`index.js:190`), mentre
 * `reconcileSchemaVersions` — che aggiunge ai config vivi le chiavi nuove dei
 * `.default` — gira dentro `startApp()` (riga 311). Su un'installazione che si
 * **aggiorna**, il primo boot costruisce quindi il middleware leggendo un config
 * vivo che non ha ancora `securityHeaders`, e `koaSession.json5` che non ha
 * ancora `CONFIG.secure`.
 *
 * Misurato: l'area admin **non riceveva `X-Frame-Options`** fino al secondo
 * riavvio. Non è un difetto del merge né del middleware: è la cucitura fra i
 * due, e la correzione non è riordinare il boot — è fare in modo che i default
 * del CODICE siano quelli sicuri, così il config serve a *rilassarli* e non ad
 * accenderli.
 */

'use strict';

const { createSecurityHeaders, DEFAULTS_PER_CONTESTO } =
  require('../../../core/priorityMiddlewares/securityHeaders');
const { resolveSecureCookieFlag } =
  require('../../../core/priorityMiddlewares/priorityMiddlewares');

/** Un config vivo come appare PRIMA del merge additivo: senza le chiavi nuove. */
function configPreAggiornamento(extra = {}) {
  return {
    adminPrefix: 'admin',
    apiPrefix: 'api',
    viewsPrefix: 'views',
    pluginPagesPrefix: 'pluginPages',
    publicThemeResourcesPrefix: 'public-theme-resources',
    adminThemeResourcesPrefix: 'admin-theme-resources',
    enableAdmin: true,
    ...extra,
    // NOTA: nessuna chiave `securityHeaders`. È il punto del test.
  };
}

const nomiHeader = (sh, reqPath) => sh.settingsFor(reqPath).headers.map(([n]) => n);

describe('su un config PRE-aggiornamento l\'hardening è già attivo', () => {
  const sh = createSecurityHeaders({ ital8Conf: configPreAggiornamento() });

  test('l\'area admin riceve X-Frame-Options: DENY', () => {
    // È la regressione misurata: prima qui non c'era.
    const headers = sh.settingsFor('/admin/').headers;
    expect(headers).toContainEqual(['X-Frame-Options', 'DENY']);
  });

  test('e lo ricevono anche le risorse del tema admin e `views`', () => {
    // Le altre zone che dichiarano `requiresAuth`: ereditano il contesto admin.
    for (const p of ['/admin-theme-resources/css/a.css', '/views/x.ejs']) {
      expect(nomiHeader(sh, p)).toContain('X-Frame-Options');
    }
  });

  test('nosniff e Referrer-Policy ci sono su ogni superficie', () => {
    for (const p of ['/index.ejs', '/pluginPages/a.ejs', '/admin/', '/api/x']) {
      expect(nomiHeader(sh, p)).toEqual(
        expect.arrayContaining(['X-Content-Type-Options', 'Referrer-Policy'])
      );
    }
  });

  test('il sito pubblico NON riceve X-Frame-Options nemmeno per default', () => {
    // Il default sicuro vale per l'area riservata, non per il sito: una pagina
    // pubblica può legittimamente essere inquadrata, e deciderlo al posto di chi
    // costruisce il sito sarebbe arbitrario.
    expect(nomiHeader(sh, '/index.ejs')).not.toContain('X-Frame-Options');
    expect(nomiHeader(sh, '/pluginPages/a.ejs')).not.toContain('X-Frame-Options');
  });

  test('la CSP resta SPENTA: il default sicuro non vuol dire « tutto acceso »', () => {
    // Accenderla senza che l'operatore l'abbia decisa romperebbe i temi.
    for (const p of ['/admin/', '/index.ejs']) {
      expect(nomiHeader(sh, p)).not.toContain('Content-Security-Policy');
    }
  });
});

describe('il config può ancora RILASSARE il default', () => {
  test('`frameOptions: ""` sull\'admin disattiva l\'header', () => {
    const sh = createSecurityHeaders({
      ital8Conf: configPreAggiornamento({ securityHeaders: { admin: { frameOptions: '' } } }),
    });
    expect(nomiHeader(sh, '/admin/')).not.toContain('X-Frame-Options');
  });

  test('un valore diverso da DENY è rispettato', () => {
    const sh = createSecurityHeaders({
      ital8Conf: configPreAggiornamento({ securityHeaders: { admin: { frameOptions: 'SAMEORIGIN' } } }),
    });
    expect(sh.settingsFor('/admin/').headers).toContainEqual(['X-Frame-Options', 'SAMEORIGIN']);
  });

  test('il default per contesto è dichiarato in un posto solo', () => {
    // Se qualcuno lo cambiasse altrove, questo test lo nominerebbe.
    expect(DEFAULTS_PER_CONTESTO.admin).toEqual({ frameOptions: 'DENY' });
  });
});

// ── Il cookie `secure`: una regola, non un interruttore ─────────────────────

describe('il cookie `secure` e il 500 che prometteva di non essere', () => {
  // `secure: true` NON significa « il login funziona solo su HTTPS »: la
  // libreria `cookies` LANCIA se le si chiede un cookie secure in chiaro.
  // Misurato: `Cannot send secure cookie over unencrypted connection` → 500 su
  // ogni scrittura di sessione via HTTP, pagina di login compresa.

  test('HTTPS + redirect attivo → secure, senza avvisi', () => {
    // L'app non è raggiungibile in chiaro: la porta HTTP la serve il server di
    // redirect, che non tocca le sessioni.
    expect(resolveSecureCookieFlag({ https: { enabled: true, AutoRedirectHttpPortToHttpsPort: true } }))
      .toEqual({ secure: true, warning: null });
  });

  test('HTTPS con HTTP in PARALLELO → NON secure, e il boot lo dice', () => {
    const esito = resolveSecureCookieFlag({
      https: { enabled: true, AutoRedirectHttpPortToHttpsPort: false },
    });

    expect(esito.secure).toBe(false);
    expect(esito.warning).toMatch(/non marcato/i);
    expect(esito.warning).toMatch(/500/);          // dice perché, non solo cosa
    expect(esito.warning).toMatch(/redirect/);     // e come chiudere il punto
  });

  test('HTTP puro → NON secure, e nessun avviso: è la configurazione di sviluppo', () => {
    expect(resolveSecureCookieFlag({ https: { enabled: false } }))
      .toEqual({ secure: false, warning: null });
  });

  test.each([{}, { https: {} }, null, undefined])(
    'config incompleto (%p) → non lancia e non marca secure', (conf) => {
      expect(resolveSecureCookieFlag(conf)).toMatchObject({ secure: false });
    });

  test('il valore restituito è un BOOLEANO, non la stringa « auto »', () => {
    // `koa-session` 7 valida con zod e rifiuta la stringa: con `"auto"` il boot
    // muore con uno ZodError e il CMS non parte (misurato nella v3.44.0).
    for (const conf of [{ https: { enabled: true, AutoRedirectHttpPortToHttpsPort: true } }, {}]) {
      expect(typeof resolveSecureCookieFlag(conf).secure).toBe('boolean');
    }
  });
});
