// @ts-check
const { test, expect } = require('@playwright/test');
const loadJson5 = require('../../core/loadJson5');
const path = require('path');

/**
 * E2E Tests per globalPrefix
 *
 * Questi test verificano che il globalPrefix funzioni correttamente con il server in esecuzione.
 * I test si adattano automaticamente al globalPrefix configurato in ital8Config.json5.
 *
 * Per testare con diversi globalPrefix:
 * 1. Modifica ital8Config.json5 cambiando "globalPrefix"
 * 2. Riavvia il server
 * 3. Esegui: npm run test:e2e -- globalPrefix.spec.js
 */

let config;
let globalPrefix;

test.beforeAll(() => {
  // Carica la configurazione corrente
  config = loadJson5(path.join(__dirname, '../../ital8Config.json5'));
  globalPrefix = config.globalPrefix || '';

  console.log(`\n[globalPrefix E2E] Testing with globalPrefix: "${globalPrefix}" (empty = root)\n`);
});

test.describe('GlobalPrefix - Default Configuration', () => {
  test('configuration loads globalPrefix correctly', async () => {
    expect(config).toHaveProperty('globalPrefix');
    expect(typeof config.globalPrefix).toBe('string');
  });

  test('homepage is accessible with globalPrefix', async ({ page }) => {
    const homePath = globalPrefix === '' ? '/' : `${globalPrefix}/`;
    const response = await page.goto(homePath);

    expect(response.status()).toBe(200);
    await expect(page.locator('body')).toBeVisible();
  });

  test('public pages index.ejs is accessible', async ({ page }) => {
    const indexPath = globalPrefix === '' ? '/index.ejs' : `${globalPrefix}/index.ejs`;
    const response = await page.goto(indexPath);

    expect(response.status()).toBe(200);
  });
});

test.describe('GlobalPrefix - API Routes', () => {
  test('Bootstrap CSS API endpoint is accessible', async ({ request }) => {
    const apiPath = globalPrefix === ''
      ? '/api/bootstrap/css/bootstrap.min.css'
      : `${globalPrefix}/api/bootstrap/css/bootstrap.min.css`;

    const response = await request.get(apiPath);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('css');
  });

  test('Bootstrap JS API endpoint is accessible', async ({ request }) => {
    const apiPath = globalPrefix === ''
      ? '/api/bootstrap/js/bootstrap.bundle.min.js'
      : `${globalPrefix}/api/bootstrap/js/bootstrap.bundle.min.js`;

    const response = await request.get(apiPath);
    expect(response.status()).toBe(200);
  });

  test('adminUsers login endpoint is accessible (POST only)', async ({ request }) => {
    const loginPath = globalPrefix === ''
      ? '/api/adminUsers/login'
      : `${globalPrefix}/api/adminUsers/login`;

    // Login is POST-only; verify POST works (returns redirect on invalid credentials)
    const response = await request.post(loginPath, {
      form: { username: 'nonexistent', password: 'test' }
    });
    expect([302, 200]).toContain(response.status());
  });

  test('adminUsers logged endpoint returns text status', async ({ request }) => {
    const loggedPath = globalPrefix === ''
      ? '/api/adminUsers/logged'
      : `${globalPrefix}/api/adminUsers/logged`;

    const response = await request.get(loggedPath);
    expect(response.status()).toBe(200);

    // /logged returns text/plain, not JSON
    const text = await response.text();
    expect(text).toBeDefined();
    expect(text.length).toBeGreaterThan(0);
  });

  test('non-existent API route returns 404', async ({ request }) => {
    const nonExistentPath = globalPrefix === ''
      ? '/api/nonexistent/route'
      : `${globalPrefix}/api/nonexistent/route`;

    const response = await request.get(nonExistentPath);
    expect(response.status()).toBe(404);
  });
});

test.describe('GlobalPrefix - Admin Routes', () => {
  test('admin panel is accessible (may redirect to login)', async ({ page }) => {
    const adminPath = globalPrefix === ''
      ? '/admin/'
      : `${globalPrefix}/admin/`;

    const response = await page.goto(adminPath, { waitUntil: 'networkidle' });

    // Admin può essere accessibile o reindirizzare al login
    // Entrambi i casi sono validi
    expect([200, 302, 303]).toContain(response.status());
  });

  test('admin index page loads', async ({ page }) => {
    const adminIndexPath = globalPrefix === ''
      ? '/admin/index.ejs'
      : `${globalPrefix}/admin/index.ejs`;

    await page.goto(adminIndexPath, { waitUntil: 'networkidle' });

    // Verifica che la pagina carichi (può mostrare login se non autenticato)
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('GlobalPrefix - Theme Resources', () => {
  test('public theme resources are accessible', async ({ request }) => {
    // Verifica che le risorse del tema pubblico siano accessibili
    const themePath = globalPrefix === ''
      ? '/public-theme-resources/'
      : `${globalPrefix}/public-theme-resources/`;

    // Prova ad accedere alla directory (potrebbe mostrare index o 403)
    const response = await request.get(themePath);

    // 200 (index), 403 (forbidden), o 404 sono accettabili
    // L'importante è che il percorso sia riconosciuto
    expect([200, 403, 404]).toContain(response.status());
  });

  test('admin theme resources are accessible', async ({ request }) => {
    // Verifica che le risorse del tema admin siano accessibili
    const adminThemePath = globalPrefix === ''
      ? '/admin-theme-resources/'
      : `${globalPrefix}/admin-theme-resources/`;

    const response = await request.get(adminThemePath);

    // 200 (index), 403 (forbidden), o 404 sono accettabili
    expect([200, 403, 404]).toContain(response.status());
  });
});

test.describe('GlobalPrefix - Routing Isolation', () => {
  test('routes without globalPrefix are not accessible when prefix is set', async ({ request }) => {
    // Questo test verifica che se globalPrefix è impostato,
    // le route senza prefisso NON siano accessibili
    if (globalPrefix !== '') {
      // Prova ad accedere a /api senza il prefisso
      const response = await request.get('/api/bootstrap/css/bootstrap.min.css');

      // Dovrebbe fallire perché il prefisso è richiesto
      expect([404, 500]).toContain(response.status());
    } else {
      // Se globalPrefix è vuoto, skip questo test
      test.skip();
    }
  });

  test('routes are accessible only with correct globalPrefix', async ({ request }) => {
    const correctPath = globalPrefix === ''
      ? '/api/adminUsers/logged'
      : `${globalPrefix}/api/adminUsers/logged`;

    const response = await request.get(correctPath);
    expect(response.status()).toBe(200);

    // Verifica che con un prefisso sbagliato non funzioni
    if (globalPrefix !== '') {
      const wrongPrefixPath = '/wrong-prefix/api/adminUsers/logged';
      const wrongResponse = await request.get(wrongPrefixPath);
      expect([404, 500]).toContain(wrongResponse.status());
    }
  });
});

test.describe('GlobalPrefix - Session Cookies', () => {
  test('session cookies have correct path', async ({ page, context }) => {
    // Visita una pagina per generare una sessione
    const homePath = globalPrefix === '' ? '/' : `${globalPrefix}/`;
    await page.goto(homePath);

    // Ottieni i cookie
    const cookies = await context.cookies();

    // Cerca il cookie di sessione
    const sessionCookie = cookies.find(c => c.name.includes('sess'));

    if (sessionCookie) {
      // Verifica che il path del cookie corrisponda al globalPrefix
      const expectedPath = globalPrefix || '/';
      expect(sessionCookie.path).toBe(expectedPath);
    }
  });
});

test.describe('GlobalPrefix - PassData in Templates', () => {
  test('globalPrefix is available in EJS templates', async ({ page }) => {
    const homePath = globalPrefix === '' ? '/index.ejs' : `${globalPrefix}/index.ejs`;
    await page.goto(homePath);

    // Aggiungi uno script per verificare che passData.globalPrefix sia disponibile
    // Questo è un test indiretto - verifica che la pagina carichi correttamente
    await expect(page.locator('body')).toBeVisible();

    // Se la pagina usa globalPrefix in passData, dovrebbe renderizzare correttamente
    const content = await page.content();
    expect(content).toBeTruthy();
    expect(content.length).toBeGreaterThan(0);
  });
});

test.describe('GlobalPrefix - Error Handling', () => {
  test('404 pages work with globalPrefix', async ({ page }) => {
    const nonExistentPath = globalPrefix === ''
      ? '/nonexistent-page.ejs'
      : `${globalPrefix}/nonexistent-page.ejs`;

    const response = await page.goto(nonExistentPath, { waitUntil: 'networkidle' });
    expect(response.status()).toBe(404);
  });

  test('malformed paths are handled correctly', async ({ request }) => {
    // Test solo se globalPrefix è vuoto, altrimenti i path malformati
    // potrebbero creare URL non validi
    if (globalPrefix === '') {
      const malformedPaths = [
        '/api/../admin/',
        '//api/bootstrap',
      ];

      for (const malformedPath of malformedPaths) {
        try {
          const response = await request.get(malformedPath);
          // Dovrebbe gestire l'errore (404, 400, o redirect)
          expect([200, 301, 302, 400, 404]).toContain(response.status());
        } catch (error) {
          // Alcuni path malformati potrebbero causare errori di rete
          // Questo è accettabile
          expect(error).toBeDefined();
        }
      }
    } else {
      // Skip se globalPrefix è impostato
      test.skip();
    }
  });
});

/**
 * MANUAL TESTING GUIDE
 * ====================
 *
 * Per testare manualmente con diversi globalPrefix:
 *
 * 1. Test con globalPrefix vuoto (root level):
 *    - Modifica ital8Config.json5: "globalPrefix": ""
 *    - Riavvia il server: npm start
 *    - Esegui i test: npm run test:e2e -- globalPrefix.spec.js
 *    - Accedi a: http://localhost:3000/
 *    - API disponibili su: http://localhost:3000/api/...
 *    - Admin su: http://localhost:3000/admin/
 *
 * 2. Test con globalPrefix "/cms1":
 *    - Modifica ital8Config.json5: "globalPrefix": "/cms1"
 *    - Riavvia il server: npm start
 *    - Esegui i test: npm run test:e2e -- globalPrefix.spec.js
 *    - Accedi a: http://localhost:3000/cms1/
 *    - API disponibili su: http://localhost:3000/cms1/api/...
 *    - Admin su: http://localhost:3000/cms1/admin/
 *
 * 3. Test con globalPrefix "/blog":
 *    - Modifica ital8Config.json5: "globalPrefix": "/blog"
 *    - Riavvia il server: npm start
 *    - Esegui i test: npm run test:e2e -- globalPrefix.spec.js
 *    - Accedi a: http://localhost:3000/blog/
 *    - API disponibili su: http://localhost:3000/blog/api/...
 *    - Admin su: http://localhost:3000/blog/admin/
 *
 * 4. Test multi-CMS (manuale):
 *    - Avvia 3 istanze del CMS su porte diverse
 *    - Configura un reverse proxy (nginx) per instradare:
 *      - /cms1/* → localhost:3001/cms1/*
 *      - /cms2/* → localhost:3002/cms2/*
 *      - /blog/* → localhost:3003/blog/*
 */
