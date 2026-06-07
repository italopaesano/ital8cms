// @ts-check

/**
 * Helper CSRF per i test E2E.
 *
 * Con la protezione csrfProtection attiva (enforce), ogni richiesta mutante
 * (POST/PUT/DELETE/PATCH) deve includere il token CSRF. I form (login/logout)
 * lo includono già via campo hidden `_csrf` renderizzato server-side; le
 * richieste fatte con `page.request.post` / `request.post` invece NO, quindi
 * vanno arricchite con il token tramite questi helper.
 */

/**
 * Estrae il token CSRF dal <meta name="csrf-token"> della pagina corrente.
 * Richiede una pagina che includa l'head del tema (che inietta il meta).
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>}
 */
async function getCsrfToken(page) {
  return await page.evaluate(() => {
    const m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.getAttribute('content') : '';
  });
}

/**
 * GET della pagina di login per stabilire la sessione e leggere il token CSRF.
 * Utilizzabile con qualsiasi APIRequestContext (fixture `request` o `page.request`):
 * la GET imposta il cookie di sessione nel jar del contesto e restituisce l'HTML
 * con il token, così la POST successiva nello stesso contesto è coerente.
 * @param {import('@playwright/test').APIRequestContext} requestCtx
 * @param {string} [loginPath]
 * @returns {Promise<string>} token CSRF (o '' se non trovato)
 */
async function fetchCsrfToken(requestCtx, loginPath = '/pluginPages/adminUsers/login.ejs') {
  const res = await requestCtx.get(loginPath);
  const html = await res.text();
  const m = html.match(/name="_csrf" value="([^"]+)"/) || html.match(/name="csrf-token" content="([^"]+)"/);
  return m ? m[1] : '';
}

/**
 * POST con header X-CSRF-Token letto dal <meta> della pagina corrente.
 * Usare DOPO una navigazione che renda il meta (es. dopo loginAs).
 * @param {import('@playwright/test').Page} page
 * @param {string} url
 * @param {object} [options] opzioni passate a page.request.post
 */
async function postWithCsrf(page, url, options = {}) {
  const token = await getCsrfToken(page);
  const headers = Object.assign({}, options.headers || {}, token ? { 'X-CSRF-Token': token } : {});
  return page.request.post(url, Object.assign({}, options, { headers }));
}

module.exports = { getCsrfToken, fetchCsrfToken, postWithCsrf };
